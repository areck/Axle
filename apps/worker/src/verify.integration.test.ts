import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { LocalArtifactStore } from "@axle/artifacts";
import {
  DEFAULT_LIMITS,
  DEFAULT_PROFILE,
  type Execution,
  emptyMetrics,
  newExecutionId,
  newStepId,
} from "@axle/contracts";
import { DiagnosticsEngine } from "@axle/diagnostics";
import { captureWorkspace } from "@axle/git";
import { SqliteExecutionStore } from "@axle/persistence";
import { analyzeProject, commandPlan, planVerification } from "@axle/planner";
import { LocalRuntime } from "@axle/runtime-local";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExecutionEngine } from "./engine";

const execFileAsync = promisify(execFile);

// The verify pipeline end-to-end minus HTTP: a real git working tree is
// captured, the planner reads it, and the engine runs the plan against the
// materialized snapshot — proving the producers wired in this pass feed the
// existing execution substrate correctly.

let projectDir: string; // the project being verified
let stateDir: string; // Axle's own db + artifacts
let store: SqliteExecutionStore;
let engine: ExecutionEngine;

async function git(args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: projectDir });
}

beforeAll(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-verify-proj-"));
  await git(["init", "-q"]);
  await git(["config", "user.email", "test@axle.dev"]);
  await git(["config", "user.name", "Axle Test"]);
  await fs.writeFile(
    path.join(projectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "demo",
        version: "1.0.0",
        scripts: { typecheck: "tsc --noEmit", test: "vitest run" },
        devDependencies: { typescript: "^5", vitest: "^2" },
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(path.join(projectDir, "package-lock.json"), "{}\n");
  await fs.writeFile(path.join(projectDir, "tsconfig.json"), "{}\n");
  await fs.mkdir(path.join(projectDir, "src"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "src/auth.ts"),
    "export const status = 200;\n",
  );
  await git(["add", "."]);
  await git(["commit", "-q", "-m", "init"]);

  // The uncommitted, broken change the agent wants verified.
  await fs.writeFile(
    path.join(projectDir, "src/auth.ts"),
    "export const status = 500;\n",
  );

  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-verify-state-"));
  store = new SqliteExecutionStore(path.join(stateDir, "axle.db"));
  engine = new ExecutionEngine({
    store,
    artifacts: new LocalArtifactStore(path.join(stateDir, "artifacts")),
    runtime: new LocalRuntime(),
    diagnostics: new DiagnosticsEngine(),
  });
});

afterAll(async () => {
  store.close();
  await fs.rm(projectDir, { recursive: true, force: true });
  await fs.rm(stateDir, { recursive: true, force: true });
});

describe("axle verify (capture → plan → execute → evidence)", () => {
  it("plans a Node + TypeScript project deterministically", () => {
    const plan = planVerification(analyzeProject(projectDir), {
      profile: "node-22",
      timeoutSeconds: 60,
    });
    const names = plan.steps.map((s) => s.name);
    expect(names[0]).toBe("install");
    expect(names).toContain("typecheck");
    expect(names).toContain("test");
    // A committed lockfile selects the frozen install path.
    expect(plan.steps[0]?.command).toBe("npm ci");
  });

  it("captures the working tree and verifies the exact change", async () => {
    const snapshot = await captureWorkspace(projectDir);

    // The uncommitted edit is what gets captured — not the committed version.
    const auth = snapshot.files.find((f) => f.path === "src/auth.ts");
    const authContent = Buffer.from(
      auth?.contentBase64 ?? "",
      "base64",
    ).toString();
    expect(authContent).toContain("500");

    // A hermetic stand-in for the test step: assert on the *materialized* file
    // so the whole capture → workspace-prep → execute path runs without a
    // network install. The change is broken, so it must fail with a diagnostic.
    const plan = commandPlan(
      `node -e "const s=require('fs').readFileSync('src/auth.ts','utf8'); if (s.includes('500')) { console.error('AssertionError: expected 200, received 500'); process.exit(1); }"`,
      { profile: "node-22", timeoutSeconds: 60 },
    );

    const execution: Execution = {
      id: newExecutionId(),
      repository: { name: path.basename(projectDir) },
      change: snapshot,
      profile: DEFAULT_PROFILE,
      plan,
      status: "queued",
      createdAt: new Date().toISOString(),
      steps: plan.steps.map((planned) => ({
        id: newStepId(),
        plannedStepId: planned.id,
        name: planned.name,
        command: planned.command,
        status: "pending" as const,
      })),
      diagnostics: [],
      artifacts: [],
      metrics: emptyMetrics(),
      limits: DEFAULT_LIMITS,
    };

    await store.createExecution(execution);
    const claimed = await store.claimNextQueued();
    await engine.runExecution(claimed as Execution);
    const final = (await store.getExecution(execution.id)) as Execution;

    expect(final.status).toBe("failed");
    expect(final.diagnostics.some((d) => d.message.includes("500"))).toBe(true);
    expect(final.artifacts.some((a) => a.name === "execution.log")).toBe(true);
  });
});
