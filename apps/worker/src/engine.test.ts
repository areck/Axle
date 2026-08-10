import { LocalArtifactStore } from "@axle/artifacts";
import {
  DEFAULT_PROFILE,
  type Execution,
  type PlannedStep,
  emptyChangeSnapshot,
  emptyMetrics,
  newExecutionId,
  newStepId,
} from "@axle/contracts";
import { DiagnosticsEngine } from "@axle/diagnostics";
import { SqliteExecutionStore } from "@axle/persistence";
import { LocalRuntime } from "@axle/runtime-local";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExecutionEngine } from "./engine";

let dir: string;
let store: SqliteExecutionStore;
let engine: ExecutionEngine;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-engine-"));
  store = new SqliteExecutionStore(path.join(dir, "axle.db"));
  engine = new ExecutionEngine({
    store,
    artifacts: new LocalArtifactStore(path.join(dir, "artifacts")),
    runtime: new LocalRuntime(),
    diagnostics: new DiagnosticsEngine(),
  });
});

afterAll(async () => {
  store.close();
  await fs.rm(dir, { recursive: true, force: true });
});

function step(overrides: Partial<PlannedStep> & { id: string }): PlannedStep {
  return {
    name: overrides.name ?? overrides.id,
    command: overrides.command ?? "true",
    timeoutSeconds: 30,
    required: true,
    ...overrides,
  };
}

function queuedExecution(steps: PlannedStep[]): Execution {
  return {
    id: newExecutionId(),
    repository: { name: "demo" },
    change: emptyChangeSnapshot(),
    profile: DEFAULT_PROFILE,
    plan: { profile: "node-22", steps },
    status: "queued",
    createdAt: new Date().toISOString(),
    steps: steps.map((planned) => ({
      id: newStepId(),
      plannedStepId: planned.id,
      name: planned.name,
      command: planned.command,
      status: "pending" as const,
    })),
    diagnostics: [],
    artifacts: [],
    metrics: emptyMetrics(),
  };
}

async function runViaQueue(execution: Execution): Promise<Execution> {
  await store.createExecution(execution);
  const claimed = await store.claimNextQueued();
  expect(claimed?.id).toBe(execution.id);
  await engine.runExecution(claimed as Execution);
  const final = await store.getExecution(execution.id);
  return final as Execution;
}

describe("ExecutionEngine (end-to-end)", () => {
  it("executes a hard-coded change and returns structured evidence", async () => {
    const final = await runViaQueue(
      queuedExecution([
        step({ id: "p1", name: "pass", command: `node -e "process.exit(0)"` }),
        step({
          id: "p2",
          name: "fail",
          command: `node -e "console.error('boom'); process.exit(1)"`,
        }),
      ]),
    );

    // Overall result reflects the failing required step.
    expect(final.status).toBe("failed");

    // Per-step observations are captured with exit codes.
    expect(final.steps[0]?.status).toBe("succeeded");
    expect(final.steps[0]?.exitCode).toBe(0);
    expect(final.steps[1]?.status).toBe("failed");
    expect(final.steps[1]?.exitCode).toBe(1);
    expect(final.steps[1]?.durationMs).toBeGreaterThanOrEqual(0);

    // Structured diagnostics — not raw terminal output.
    expect(final.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(final.diagnostics.some((d) => d.message.includes("boom"))).toBe(true);

    // Evidence artifact.
    expect(final.artifacts.some((a) => a.name === "execution.log")).toBe(true);

    // Metrics.
    expect(final.metrics.stepCount).toBe(2);
    expect(final.metrics.failedStepCount).toBe(1);

    // A replayable, structured event stream.
    const events = await store.listEventsSince(final.id, 0);
    const types = events.map((e) => e.event.type);
    expect(types).toContain("execution.started");
    expect(types).toContain("step.started");
    expect(types).toContain("step.completed");
    expect(types).toContain("execution.completed");
  });

  it("stops at the first required failure and skips the rest", async () => {
    const final = await runViaQueue(
      queuedExecution([
        step({ id: "p1", name: "fail", command: `node -e "process.exit(1)"` }),
        step({ id: "p2", name: "after", command: `node -e "process.exit(0)"` }),
      ]),
    );
    expect(final.status).toBe("failed");
    expect(final.steps[0]?.status).toBe("failed");
    expect(final.steps[1]?.status).toBe("skipped");
  });

  it("succeeds when every required step passes", async () => {
    const final = await runViaQueue(
      queuedExecution([
        step({ id: "p1", name: "one", command: `node -e "process.exit(0)"` }),
        step({ id: "p2", name: "two", command: "echo ok" }),
      ]),
    );
    expect(final.status).toBe("succeeded");
    expect(final.metrics.failedStepCount).toBe(0);
    expect(final.artifacts.some((a) => a.name === "execution.log")).toBe(true);
  });
});
