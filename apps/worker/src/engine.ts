import type { ArtifactStore } from "@axle/artifacts";
import {
  type Artifact,
  DEFAULT_LIMITS,
  type Diagnostic,
  type Execution,
  type ExecutionEvent,
  type ExecutionMetrics,
  type ExecutionStatus,
  type ExecutionStepStatus,
  newArtifactId,
} from "@axle/contracts";
import type { DiagnosticsEngine } from "@axle/diagnostics";
import type { ExecutionStore } from "@axle/persistence";
import type { ExecutionEnvironment, Runtime } from "@axle/runtime";

export interface EngineDeps {
  store: ExecutionStore;
  artifacts: ArtifactStore;
  runtime: Runtime;
  diagnostics: DiagnosticsEngine;
  logger?: (message: string) => void;
}

const now = (): string => new Date().toISOString();

/**
 * The Execution engine.
 *
 * Given a claimed execution, it provisions an environment, prepares the
 * workspace, runs the plan steps sequentially while streaming structured
 * events, parses diagnostics, collects evidence, persists the result, and — via
 * `finally` — always tears the environment down.
 */
export class ExecutionEngine {
  constructor(private readonly deps: EngineDeps) {}

  async runExecution(execution: Execution): Promise<void> {
    const { store, runtime, diagnostics } = this.deps;
    const limits = DEFAULT_LIMITS;
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
    let failedStepCount = 0;

    try {
      await store.updateExecutionStatus(execution.id, "provisioning");
      emit({
        type: "execution.status",
        executionId: execution.id,
        status: "provisioning",
        at: now(),
      });

      env = await runtime.createEnvironment({
        executionId: execution.id,
        profile: execution.profile,
        limits,
      });
      await env.prepareWorkspace(execution.change);

      await store.updateExecutionStatus(execution.id, "running");
      emit({ type: "execution.started", executionId: execution.id, at: now() });

      for (const step of execution.steps) {
        if (!cancelled && (await store.isCancelRequested(execution.id))) {
          cancelled = true;
        }
        if (cancelled || failedRequired) {
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
        const remainingSeconds = Math.ceil((totalDeadline - Date.now()) / 1000);
        const timeoutSeconds = Math.max(
          1,
          Math.min(planned?.timeoutSeconds ?? 600, remainingSeconds),
        );

        const stepStart = now();
        await store.updateStep({ ...step, status: "running", startedAt: stepStart });
        emit({
          type: "step.started",
          executionId: execution.id,
          stepId: step.id,
          name: step.name,
          command: step.command,
          at: stepStart,
        });
        logParts.push(`\n$ ${step.command}\n`);

        let stdout = "";
        let stderr = "";
        let combined = "";
        const result = await env.run({
          command: step.command,
          timeoutSeconds,
          maxOutputBytes: limits.maxOutputBytes,
          onOutput: (chunk) => {
            combined += chunk.data;
            if (chunk.stream === "stdout") stdout += chunk.data;
            else stderr += chunk.data;
            logParts.push(chunk.data);
            emit({
              type: "step.output",
              executionId: execution.id,
              stepId: step.id,
              stream: chunk.stream,
              data: chunk.data,
              at: now(),
            });
          },
        });

        const status: ExecutionStepStatus = result.timedOut
          ? "timedOut"
          : result.exitCode === 0
            ? "succeeded"
            : "failed";
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

        allDiagnostics.push(
          ...diagnostics.parseStep({
            stepId: step.id,
            name: step.name,
            command: step.command,
            stdout,
            stderr,
            combined,
            exitCode: result.exitCode,
          }),
        );

        if (status !== "succeeded") {
          failedStepCount += 1;
          if (required) failedRequired = true;
        }
      }

      if (allDiagnostics.length > 0) {
        await store.addDiagnostics(execution.id, allDiagnostics);
      }
      await this.storeLog(execution.id, logParts.join(""));

      const finalStatus: ExecutionStatus = cancelled
        ? "cancelled"
        : failedRequired
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
