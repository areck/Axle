import { describe, expect, it } from "vitest";
import { DiagnosticsEngine } from "./engine";
import type { ParseContext } from "./types";

function ctx(partial: Partial<ParseContext>): ParseContext {
  return {
    stepId: "step_1",
    name: "step",
    command: "",
    stdout: "",
    stderr: "",
    combined: "",
    exitCode: 0,
    ...partial,
  };
}

describe("DiagnosticsEngine", () => {
  const engine = new DiagnosticsEngine();

  it("parses TypeScript compiler errors into build diagnostics", () => {
    const output =
      "src/auth/auth.ts(18,7): error TS2322: Type 'string' is not assignable to type 'number'.";
    const diagnostics = engine.parseStep(
      ctx({
        name: "typecheck",
        command: "tsc --noEmit",
        combined: output,
        stdout: output,
        exitCode: 2,
      }),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      type: "build",
      severity: "error",
      file: "src/auth/auth.ts",
      line: 18,
      column: 7,
      stepId: "step_1",
    });
    expect(diagnostics[0]?.message).toContain("TS2322");
  });

  it("falls back to a generic diagnostic for an unstructured failure", () => {
    const diagnostics = engine.parseStep(
      ctx({
        name: "test",
        command: "npm test",
        combined: "FAIL src/auth/auth.test.ts\nboom: expected 401 received 500",
        exitCode: 1,
      }),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.type).toBe("test");
    expect(diagnostics[0]?.message).toContain("500");
  });

  it("produces no diagnostics for a successful step", () => {
    const diagnostics = engine.parseStep(
      ctx({ name: "test", combined: "ok", exitCode: 0 }),
    );
    expect(diagnostics).toEqual([]);
  });
});
