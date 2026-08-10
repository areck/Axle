import {
  DEFAULT_PROFILE,
  type Execution,
  emptyChangeSnapshot,
  emptyMetrics,
  newExecutionId,
  newStepId,
} from "@axle/contracts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SqliteExecutionStore } from "./execution-store";

let dir: string;
let store: SqliteExecutionStore;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-db-"));
  store = new SqliteExecutionStore(path.join(dir, "axle.db"));
});

afterAll(async () => {
  store.close();
  await fs.rm(dir, { recursive: true, force: true });
});

function queuedExecution(): Execution {
  return {
    id: newExecutionId(),
    repository: { name: "demo" },
    change: emptyChangeSnapshot(),
    profile: DEFAULT_PROFILE,
    plan: {
      profile: "node-22",
      steps: [
        {
          id: "p1",
          name: "install",
          command: "echo install",
          timeoutSeconds: 600,
          required: true,
        },
        {
          id: "p2",
          name: "test",
          command: "echo test",
          timeoutSeconds: 600,
          required: true,
        },
      ],
    },
    status: "queued",
    createdAt: new Date().toISOString(),
    steps: [
      {
        id: newStepId(),
        plannedStepId: "p1",
        name: "install",
        command: "echo install",
        status: "pending",
      },
      {
        id: newStepId(),
        plannedStepId: "p2",
        name: "test",
        command: "echo test",
        status: "pending",
      },
    ],
    diagnostics: [],
    artifacts: [],
    metrics: emptyMetrics(),
  };
}

describe("SqliteExecutionStore", () => {
  it("creates and retrieves an execution with its steps", async () => {
    const execution = queuedExecution();
    await store.createExecution(execution);
    const fetched = await store.getExecution(execution.id);
    expect(fetched?.status).toBe("queued");
    expect(fetched?.steps).toHaveLength(2);
    expect(fetched?.steps[0]?.name).toBe("install");
  });

  it("lists executions", async () => {
    const result = await store.listExecutions({ limit: 50, offset: 0 });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.executions[0]?.repositoryName).toBe("demo");
  });

  it("atomically claims the queued execution exactly once", async () => {
    const execution = queuedExecution();
    await store.createExecution(execution);

    const first = await store.claimNextQueued();
    expect(first).toBeDefined();
    expect(first?.status).toBe("provisioning");

    // Claiming again must not return the same execution.
    const claimedIds = new Set<string>();
    if (first) claimedIds.add(first.id);
    let next = await store.claimNextQueued();
    while (next) {
      expect(claimedIds.has(next.id)).toBe(false);
      claimedIds.add(next.id);
      next = await store.claimNextQueued();
    }
  });

  it("appends and replays events by sequence", async () => {
    const execution = queuedExecution();
    await store.createExecution(execution);
    const seq1 = await store.appendEvent({
      type: "execution.started",
      executionId: execution.id,
      at: new Date().toISOString(),
    });
    const seq2 = await store.appendEvent({
      type: "execution.completed",
      executionId: execution.id,
      status: "succeeded",
      at: new Date().toISOString(),
    });
    expect(seq2).toBeGreaterThan(seq1);

    const all = await store.listEventsSince(execution.id, 0);
    expect(all).toHaveLength(2);
    const afterFirst = await store.listEventsSince(execution.id, seq1);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]?.event.type).toBe("execution.completed");
  });

  it("records diagnostics and artifacts on an execution", async () => {
    const execution = queuedExecution();
    await store.createExecution(execution);
    await store.addDiagnostics(execution.id, [
      { type: "test", severity: "error", message: "expected 401 received 500" },
    ]);
    await store.addArtifact({
      id: "art_1",
      executionId: execution.id,
      type: "log",
      name: "execution.log",
      storageKey: `${execution.id}/execution.log`,
      sizeBytes: 42,
    });
    const fetched = await store.getExecution(execution.id);
    expect(fetched?.diagnostics).toHaveLength(1);
    expect(fetched?.artifacts[0]?.name).toBe("execution.log");
  });

  it("tracks cancellation requests", async () => {
    const execution = queuedExecution();
    await store.createExecution(execution);
    expect(await store.isCancelRequested(execution.id)).toBe(false);
    expect(await store.requestCancel(execution.id)).toBe(true);
    expect(await store.isCancelRequested(execution.id)).toBe(true);
  });
});
