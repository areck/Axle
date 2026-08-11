import type { ArtifactStore } from "@axle/artifacts";
import {
  type Artifact,
  type Diagnostic,
  type Execution,
  type ExecutionEvent,
  type ExecutionMetrics,
  type ExecutionStatus,
  type ExecutionStepStatus,
  newArtifactId,
} from "@axle/contracts";
import type { DiagnosticsEngine } from "@axle/diagnostics";
import type { EnvironmentStore, ExecutionStore } from "@axle/persistence";
import type { ExecutionEnvironment, Runtime } from "@axle/runtime";
import { OutputCoalescer } from "./output-coalescer";
import { makeRedactor } from "./redact";

export interface EngineDeps {
  store: ExecutionStore;
  artifacts: ArtifactStore;
  runtime: Runtime;
  diagnostics: DiagnosticsEngine;
  /** Resolves an execution's referenced environment (vars + secret values). */
  environments?: EnvironmentStore;
  logger?: (message: string) => void;
}

const now = (): string => new Date().toISOString();

/** How often to check for a cancel request while a single step is running. */
const CANCEL_POLL_MS = 750;

/** Buffer this many bytes of step output before emitting a `step.output` event. */
const OUTPUT_EVENT_THRESHOLD_BYTES = 16 * 1024;

/**
 * The Execution engine.
 *
 * Given a claimed execution, it provisions an environment, prepares the
 * workspace, runs the plan steps sequentially while streaming structured
 * events, parses diagnostics, collects evidence, persists the result, and — via
 * `finally` — always tears the environment down. Resource limits (total time
 * budget, per-step output cap) come from the {@link Execution} itself, i.e. from
 * whatever the admission policy decided.
 */
export class ExecutionEngine {
  constructor(private readonly deps: EngineDeps) {}

  async runExecution(execution: Execution): Promise<void> {
    const { store, runtime, diagnostics } = this.deps;
    const limits = execution.limits;
    const totalDeadline = Date.now() + limits.totalTimeoutSeconds * 1000;
    const startedAtMs = Date.now();

    const emit = (event: ExecutionEvent): void => {
      // appendEvent runs a synchronous DB write; swallow errors so a logging
      // failure never aborts an execution.
      void store
        .appendEvent(event)
        .catch((error) => this.log(`event write failed: ${error}`));
    };

    let env: ExecutionEnvironment | undefined;
    const logParts: string[] = [];
    const allDiagnostics: Diagnostic[] = [];
    let failedRequired = false;
    let cancelled = false;
    let deadlineExceeded = false;
    let failedStepCount = 0;

    try {
      await store.updateExecutionStatus(execution.id, "provisioning");
      emit({
        type: "execution.status",
        executionId: execution.id,
        status: "provisioning",
        at: now(),
      });

      // Resolve the referenced control-plane environment (vars + secret
      // values). Secret values are injected into the sandbox and redacted from
      // all captured output; they are never persisted onto the execution.
      const { variables, secrets } = await this.resolveEnvironment(execution);
      const redact = makeRedactor(Object.values(secrets));

      env = await runtime.createEnvironment({
        executionId: execution.id,
        profile: execution.profile,
        limits,
        env: { ...variables, ...secrets },
      });
      await env.prepareWorkspace(execution.change);

      await store.updateExecutionStatus(execution.id, "running");
      emit({ type: "execution.started", executionId: execution.id, at: now() });

      for (const step of execution.steps) {
        if (!cancelled && (await store.isCancelRequested(execution.id))) {
          cancelled = true;
        }
        if (
          !cancelled &&
          !failedRequired &&
          !deadlineExceeded &&
          Date.now() >= totalDeadline
        ) {
          deadlineExceeded = true;
        }
        if (cancelled || failedRequired || deadlineExceeded) {
          await store.updateStep({ ...step, status: "skipped" });
          emit({
            type: "step.completed",
            executionId: execution.id,
            stepId: step.id,
            status: "skipped",
            exitCode: null,
            durationMs: 0,
            at: now(),
          });
          continue;
        }

        const planned = execution.plan.steps.find(
          (p) => p.id === step.plannedStepId,
        );
        const required = planned?.required ?? true;
        // Clamp the per-step timeout to the remaining total budget so no single
        // step can overrun the execution's wall-clock limit.
        const remainingSeconds = Math.ceil((totalDeadline - Date.now()) / 1000);
        const timeoutSeconds = Math.max(
          1,
          Math.min(planned?.timeoutSeconds ?? 600, remainingSeconds),
        );

        const stepStart = now();
        await store.updateStep({
          ...step,
          status: "running",
          startedAt: stepStart,
        });
        emit({
          type: "step.started",
          executionId: execution.id,
          stepId: step.id,
          name: step.name,
          command: step.command,
          at: stepStart,
        });
        logParts.push(`\n$ ${step.command}\n`);

        let output = "";
        const coalescer = new OutputCoalescer(
          OUTPUT_EVENT_THRESHOLD_BYTES,
          (chunk) => {
            emit({
              type: "step.output",
              executionId: execution.id,
              stepId: step.id,
              stream: chunk.stream,
              data: chunk.data,
              at: now(),
            });
          },
        );

        // Cancellation that arrives mid-step: poll and abort the running command
        // rather than waiting for the next step boundary.
        const controller = new AbortController();
        const cancelPoll = setInterval(() => {
          void store
            .isCancelRequested(execution.id)
            .then((requested) => {
              if (requested && !cancelled) {
                cancelled = true;
                controller.abort();
              }
            })
            .catch(() => {});
        }, CANCEL_POLL_MS);
        cancelPoll.unref?.();

        let result: Awaited<ReturnType<ExecutionEnvironment["run"]>>;
        try {
          result = await env.run({
            command: step.command,
            timeoutSeconds,
            maxOutputBytes: limits.maxOutputBytes,
            signal: controller.signal,
            onOutput: (chunk) => {
              const data = redact(chunk.data);
              output += data;
              logParts.push(data);
              coalescer.push({ stream: chunk.stream, data });
            },
          });
        } finally {
          clearInterval(cancelPoll);
          coalescer.flush();
        }

        // `cancelled` flips to true only if the poll aborted this step.
        const interrupted = cancelled;
        let status: ExecutionStepStatus = result.timedOut
          ? "timedOut"
          : result.exitCode === 0
            ? "succeeded"
            : "failed";
        // A step aborted for cancellation isn't a real failure — record it as
        // skipped, consistent with the steps that never started.
        if (interrupted && status !== "succeeded") {
          status = "skipped";
        }

        const stepEnd = now();
        await store.updateStep({
          ...step,
          status,
          exitCode: result.exitCode,
          startedAt: stepStart,
          completedAt: stepEnd,
          durationMs: result.durationMs,
          outputBytes: result.outputBytes,
          truncated: result.truncated,
        });
        emit({
          type: "step.completed",
          executionId: execution.id,
          stepId: step.id,
          status,
          exitCode: result.exitCode ?? null,
          durationMs: result.durationMs,
          at: stepEnd,
        });

        // Diagnostics explain problems, so only parse steps that actually
        // failed — a succeeded step whose output happens to resemble an error
        // must not manufacture a false diagnostic.
        if (status === "failed" || status === "timedOut") {
          allDiagnostics.push(
            ...diagnostics.parseStep({
              stepId: step.id,
              name: step.name,
              command: step.command,
              output,
              exitCode: result.exitCode,
            }),
          );
          failedStepCount += 1;
          if (required) failedRequired = true;
        }
      }

      if (deadlineExceeded) {
        allDiagnostics.push({
          type: "infrastructure",
          severity: "error",
          message: `Execution exceeded its ${limits.totalTimeoutSeconds}s total time budget; remaining steps were skipped.`,
        });
      }

      if (allDiagnostics.length > 0) {
        await store.addDiagnostics(execution.id, allDiagnostics);
      }
      await this.storeLog(execution.id, logParts.join(""));

      const finalStatus: ExecutionStatus = cancelled
        ? "cancelled"
        : failedRequired || deadlineExceeded
          ? "failed"
          : "succeeded";
      const completedAt = now();
      const metrics: ExecutionMetrics = {
        queueWaitMs: execution.startedAt
          ? Math.max(
              0,
              Date.parse(execution.startedAt) - Date.parse(execution.createdAt),
            )
          : undefined,
        totalDurationMs: Date.now() - startedAtMs,
        stepCount: execution.steps.length,
        failedStepCount,
      };
      await store.updateExecutionStatus(execution.id, finalStatus, {
        completedAt,
        metrics,
      });
      emit({
        type: "execution.completed",
        executionId: execution.id,
        status: finalStatus,
        at: completedAt,
      });
      this.log(`execution ${execution.id} -> ${finalStatus}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`execution ${execution.id} errored: ${message}`);
      try {
        await store.addDiagnostics(execution.id, [
          { type: "infrastructure", severity: "error", message },
        ]);
        await this.storeLog(
          execution.id,
          `${logParts.join("")}\n[axle] execution error: ${message}\n`,
        );
        await store.updateExecutionStatus(execution.id, "failed", {
          completedAt: now(),
          metrics: {
            stepCount: execution.steps.length,
            failedStepCount: Math.max(1, failedStepCount),
          },
        });
        emit({
          type: "execution.completed",
          executionId: execution.id,
          status: "failed",
          at: now(),
        });
      } catch (persistError) {
        this.log(`failed to persist failure: ${persistError}`);
      }
    } finally {
      if (env) {
        try {
          await env.destroy();
        } catch (cleanupError) {
          this.log(`environment cleanup failed: ${cleanupError}`);
        }
      }
    }
  }

  /**
   * Resolve the execution's referenced environment into concrete variables and
   * secret values. Returns empties when no environment is referenced; throws
   * (failing the execution) when one is referenced but unavailable, rather than
   * silently running without the config a step likely depends on.
   */
  private async resolveEnvironment(execution: Execution): Promise<{
    variables: Record<string, string>;
    secrets: Record<string, string>;
  }> {
    if (!execution.environment) return { variables: {}, secrets: {} };
    const store = this.deps.environments;
    if (!store) {
      throw new Error(
        `Execution references environment "${execution.environment}" but no environment store is configured.`,
      );
    }
    const resolved = await store.resolveEnvironment(execution.environment);
    if (!resolved) {
      throw new Error(`Environment not found: ${execution.environment}`);
    }
    return resolved;
  }

  private async storeLog(executionId: string, content: string): Promise<void> {
    const stored = await this.deps.artifacts.put({
      executionId,
      type: "log",
      name: "execution.log",
      mimeType: "text/plain",
      data: content.length > 0 ? content : "(no output)\n",
    });
    const artifact: Artifact = {
      id: newArtifactId(),
      executionId,
      type: "log",
      name: "execution.log",
      mimeType: "text/plain",
      sizeBytes: stored.sizeBytes,
      storageKey: stored.storageKey,
    };
    await this.deps.store.addArtifact(artifact);
  }

  private log(message: string): void {
    this.deps.logger?.(message);
  }
}
