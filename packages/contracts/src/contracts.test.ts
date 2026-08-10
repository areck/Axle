import { describe, expect, it } from "vitest";
import {
  CreateExecutionRequestSchema,
  ExecutionEventSchema,
  ExecutionSchema,
  emptyChangeSnapshot,
  emptyMetrics,
  isTerminalStatus,
  newExecutionId,
} from "./index";

describe("ids", () => {
  it("produces prefixed, unique execution ids", () => {
    const a = newExecutionId();
    const b = newExecutionId();
    expect(a).toMatch(/^exec_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a).not.toBe(b);
  });
});

describe("CreateExecutionRequestSchema", () => {
  it("applies defaults and validates a minimal request", () => {
    const parsed = CreateExecutionRequestSchema.parse({
      repository: { name: "demo" },
      plan: {
        profile: "node-22",
        steps: [{ id: "s1", name: "run", command: "echo hi" }],
      },
    });
    expect(parsed.plan.steps[0]?.timeoutSeconds).toBe(600);
    expect(parsed.plan.steps[0]?.required).toBe(true);
  });

  it("rejects a request without a plan", () => {
    const result = CreateExecutionRequestSchema.safeParse({
      repository: { name: "demo" },
    });
    expect(result.success).toBe(false);
  });
});

describe("ExecutionSchema", () => {
  it("round-trips a full execution", () => {
    const execution = ExecutionSchema.parse({
      id: newExecutionId(),
      repository: { name: "demo" },
      change: emptyChangeSnapshot(),
      profile: { name: "node-22" },
      plan: { profile: "node-22", steps: [] },
      status: "queued",
      createdAt: new Date().toISOString(),
      metrics: emptyMetrics(),
    });
    expect(execution.steps).toEqual([]);
    expect(execution.status).toBe("queued");
  });
});

describe("ExecutionEventSchema", () => {
  it("discriminates event variants", () => {
    const event = ExecutionEventSchema.parse({
      type: "step.output",
      executionId: "exec_1",
      stepId: "step_1",
      stream: "stderr",
      data: "boom",
      at: new Date().toISOString(),
    });
    expect(event.type).toBe("step.output");
  });
});

describe("isTerminalStatus", () => {
  it("classifies terminal vs in-flight statuses", () => {
    expect(isTerminalStatus("succeeded")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("running")).toBe(false);
    expect(isTerminalStatus("queued")).toBe(false);
  });
});
