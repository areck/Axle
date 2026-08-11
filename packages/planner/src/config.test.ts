import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectAnalysis } from "./analyze";
import {
  loadVerifyConfig,
  planFromConfig,
  suggestedConfig,
  suggestedConfigYaml,
} from "./config";
import { buildInitPrompt } from "./init-prompt";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-cfg-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const nodeAnalysis: ProjectAnalysis = {
  packageManager: "npm",
  hasLockfile: true,
  scripts: { test: "vitest run", typecheck: "tsc --noEmit", build: "tsc" },
  hasTypeScript: true,
};

describe("loadVerifyConfig", () => {
  it("returns null when no config file is present", () => {
    expect(loadVerifyConfig(dir)).toBeNull();
  });

  it("loads and validates axle.yaml", async () => {
    await fs.writeFile(
      path.join(dir, "axle.yaml"),
      "steps:\n  - name: test\n    command: npm test\n",
    );
    const loaded = loadVerifyConfig(dir);
    expect(loaded?.config.steps[0]?.command).toBe("npm test");
    expect(loaded?.config.steps[0]?.required).toBe(true); // default
    expect(loaded?.path).toBe(path.join(dir, "axle.yaml"));
  });

  it("throws a clear error on malformed YAML", async () => {
    await fs.writeFile(path.join(dir, "axle.yaml"), "steps: [oops\n");
    expect(() => loadVerifyConfig(dir)).toThrow(/Could not parse axle\.yaml/);
  });

  it("throws a schema error on an invalid config", async () => {
    await fs.writeFile(path.join(dir, "axle.yaml"), "steps: []\n");
    expect(() => loadVerifyConfig(dir)).toThrow(/Invalid axle\.yaml/);
  });
});

describe("planFromConfig", () => {
  it("maps steps verbatim with stable, unique slug ids", () => {
    const plan = planFromConfig({
      profile: "node-22",
      steps: [
        {
          name: "install",
          command: "npm ci",
          required: true,
          timeoutSeconds: 600,
        },
        {
          name: "End to End",
          command: "pnpm e2e",
          required: false,
          timeoutSeconds: 1800,
        },
        {
          name: "End to End",
          command: "pnpm e2e:extra",
          required: false,
          timeoutSeconds: 1800,
        },
      ],
    });
    expect(plan.steps.map((s) => s.id)).toEqual([
      "install",
      "end-to-end",
      "end-to-end-2",
    ]);
    expect(plan.steps[1]).toMatchObject({
      command: "pnpm e2e",
      required: false,
      timeoutSeconds: 1800,
    });
    expect(plan.reason).toContain("axle.yaml");
  });
});

describe("suggestedConfig", () => {
  it("mirrors the auto-detected plan and round-trips through the loader", async () => {
    const suggested = suggestedConfig(nodeAnalysis);
    expect(suggested.steps.map((s) => s.name)).toEqual([
      "install",
      "typecheck",
      "test",
      "build",
    ]);

    // The serialized YAML is itself a valid axle.yaml.
    await fs.writeFile(
      path.join(dir, "axle.yaml"),
      suggestedConfigYaml(nodeAnalysis),
    );
    const loaded = loadVerifyConfig(dir);
    expect(loaded?.config.steps.map((s) => s.command)).toEqual([
      "npm ci",
      "npm run typecheck",
      "npm test",
      "npm run build",
    ]);
  });
});

describe("buildInitPrompt", () => {
  it("includes the schema, detected context, and a write instruction", () => {
    const prompt = buildInitPrompt(nodeAnalysis);
    expect(prompt).toContain("axle.yaml");
    expect(prompt).toContain("package manager: npm (lockfile present)");
    expect(prompt).toContain("TypeScript: yes");
    expect(prompt).toContain("Write the final YAML to `axle.yaml`");
    // Embeds the auto-detected starting point.
    expect(prompt).toContain("npm ci");
  });

  it("references an existing config when one is passed", () => {
    const prompt = buildInitPrompt(nodeAnalysis, {
      profile: "node-22",
      steps: [
        {
          name: "test",
          command: "make test",
          required: true,
          timeoutSeconds: 600,
        },
      ],
    });
    expect(prompt).toContain("already has an axle.yaml");
    expect(prompt).toContain("make test");
  });
});
