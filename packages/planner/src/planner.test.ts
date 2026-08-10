import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeProject } from "./analyze";
import { planVerification } from "./plan";

const created: string[] = [];

async function project(
  pkg: object,
  files: Record<string, string> = {},
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-planner-"));
  created.push(dir);
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(pkg));
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content);
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("analyzeProject", () => {
  it("detects pnpm + TypeScript + a lockfile", async () => {
    const dir = await project(
      {
        scripts: { test: "vitest run" },
        devDependencies: { typescript: "^5", vitest: "^2" },
      },
      { "pnpm-lock.yaml": "", "tsconfig.json": "{}" },
    );
    const analysis = analyzeProject(dir);
    expect(analysis.packageManager).toBe("pnpm");
    expect(analysis.hasTypeScript).toBe(true);
    expect(analysis.hasLockfile).toBe(true);
  });

  it("detects npm from package-lock.json and defaults to npm (no lockfile)", async () => {
    const npm = await project({}, { "package-lock.json": "{}" });
    const npmAnalysis = analyzeProject(npm);
    expect(npmAnalysis.packageManager).toBe("npm");
    expect(npmAnalysis.hasLockfile).toBe(true);

    const bare = await project({});
    const bareAnalysis = analyzeProject(bare);
    expect(bareAnalysis.packageManager).toBe("npm");
    expect(bareAnalysis.hasLockfile).toBe(false);
  });

  it("throws for a non-Node directory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-planner-"));
    created.push(dir);
    expect(() => analyzeProject(dir)).toThrow();
  });
});

describe("planVerification", () => {
  const opts = { profile: "node-22", timeoutSeconds: 600 };

  it("plans install → typecheck → lint → test → build with the right commands", async () => {
    const dir = await project(
      {
        scripts: {
          typecheck: "tsc --noEmit",
          lint: "biome check .",
          test: "vitest run",
          build: "tsc",
        },
      },
      { "package-lock.json": "{}" },
    );
    const plan = planVerification(analyzeProject(dir), opts);
    const byId = new Map(plan.steps.map((s) => [s.id, s]));

    expect(plan.steps.map((s) => s.id)).toEqual([
      "install",
      "typecheck",
      "lint",
      "test",
      "build",
    ]);
    expect(byId.get("install")?.command).toBe("npm ci");
    expect(byId.get("typecheck")?.command).toBe("npm run typecheck");
    expect(byId.get("test")?.command).toBe("npm test");
    expect(byId.get("install")?.required).toBe(true);
    expect(byId.get("lint")?.required).toBe(false); // non-blocking
    expect(byId.get("build")?.required).toBe(false); // non-blocking
  });

  it("skips absent scripts and uses the detected package manager", async () => {
    const dir = await project(
      { scripts: { test: "vitest run" } },
      { "pnpm-lock.yaml": "" },
    );
    const plan = planVerification(analyzeProject(dir), opts);
    expect(plan.steps.map((s) => s.id)).toEqual(["install", "test"]);
    expect(plan.steps[0]?.command).toBe("pnpm install --frozen-lockfile");
    expect(plan.steps[1]?.command).toBe("pnpm test");
  });

  it("falls back to a plain install when there is no lockfile", async () => {
    const npm = await project({ scripts: { test: "node --test" } });
    expect(planVerification(analyzeProject(npm), opts).steps[0]?.command).toBe(
      "npm install",
    );

    const pnpm = await project(
      { scripts: { test: "vitest run" } },
      { "pnpm-lock.yaml": "" },
    );
    // sanity: lockfile present still uses the frozen path
    expect(planVerification(analyzeProject(pnpm), opts).steps[0]?.command).toBe(
      "pnpm install --frozen-lockfile",
    );
  });
});
