import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureWorkspace } from "./capture";
import { isGitRepo } from "./git";

const execFileAsync = promisify(execFile);
let dir: string;

async function git(args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: dir });
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-git-"));
  await git(["init", "-q"]);
  await git(["config", "user.email", "test@axle.dev"]);
  await git(["config", "user.name", "Axle Test"]);

  await fs.writeFile(
    path.join(dir, ".gitignore"),
    "node_modules/\nignored.txt\n",
  );
  await fs.writeFile(path.join(dir, ".axleignore"), "docs/**\n");
  await fs.writeFile(path.join(dir, "index.ts"), "export const x = 1;\n");
  await fs.mkdir(path.join(dir, "docs"), { recursive: true });
  await fs.writeFile(path.join(dir, "docs/notes.md"), "notes\n");
  await fs.writeFile(path.join(dir, ".env"), "SECRET=shh\n");
  await fs.writeFile(path.join(dir, "ignored.txt"), "nope\n");
  await git(["add", "index.ts", ".gitignore", ".axleignore", "docs/notes.md"]);
  await git(["commit", "-q", "-m", "init"]);

  // an untracked file + an uncommitted modification of a tracked file
  await fs.writeFile(path.join(dir, "extra.ts"), "export const y = 2;\n");
  await fs.writeFile(path.join(dir, "index.ts"), "export const x = 2;\n");
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("captureWorkspace", () => {
  it("detects a git repository", async () => {
    expect(await isGitRepo(dir)).toBe(true);
    expect(await isGitRepo(os.tmpdir())).toBe(false);
  });

  it("captures tracked + untracked source and excludes ignored & secrets", async () => {
    const snapshot = await captureWorkspace(dir);
    const paths = snapshot.files.map((f) => f.path);

    expect(snapshot.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(paths).toContain("index.ts"); // tracked (modified)
    expect(paths).toContain("extra.ts"); // untracked
    expect(paths).not.toContain(".env"); // secret denylist
    expect(paths).not.toContain("ignored.txt"); // .gitignore
    expect(paths).not.toContain("docs/notes.md"); // .axleignore

    // Captured content reflects the uncommitted modification.
    const index = snapshot.files.find((f) => f.path === "index.ts");
    const content = Buffer.from(
      index?.contentBase64 ?? "",
      "base64",
    ).toString();
    expect(content).toContain("x = 2");
  });

  it("reports changed-file metadata", async () => {
    const snapshot = await captureWorkspace(dir);
    const changed = snapshot.changedFiles.map((c) => c.path);
    expect(changed.some((p) => p.includes("index.ts"))).toBe(true);
    expect(changed.some((p) => p.includes("extra.ts"))).toBe(true);
  });

  it("captures files larger than 1 MiB (no silent per-file drop)", async () => {
    const bigPath = path.join(dir, "big.txt");
    await fs.writeFile(bigPath, "x".repeat(1_500_000));
    try {
      const snapshot = await captureWorkspace(dir);
      const big = snapshot.files.find((f) => f.path === "big.txt");
      expect(big?.sizeBytes).toBe(1_500_000);
    } finally {
      await fs.rm(bigPath);
    }
  });

  it("scopes capture to the invocation subtree in a larger repo", async () => {
    // A repo with a nested project, mimicking `examples/*` inside the monorepo.
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "axle-sub-"));
    try {
      await execFileAsync("git", ["init", "-q"], { cwd: repo });
      await execFileAsync("git", ["config", "user.email", "t@axle.dev"], {
        cwd: repo,
      });
      await execFileAsync("git", ["config", "user.name", "T"], { cwd: repo });
      await fs.writeFile(path.join(repo, "root.ts"), "export const r = 1;\n");
      await fs.mkdir(path.join(repo, "project"), { recursive: true });
      await fs.writeFile(
        path.join(repo, "project/app.ts"),
        "export const a = 1;\n",
      );
      await execFileAsync("git", ["add", "."], { cwd: repo });
      await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: repo });

      // Uncommitted edits both outside and inside the nested project.
      await fs.writeFile(path.join(repo, "root.ts"), "export const r = 2;\n");
      await fs.writeFile(
        path.join(repo, "project/app.ts"),
        "export const a = 2;\n",
      );

      const snapshot = await captureWorkspace(path.join(repo, "project"));
      const paths = snapshot.files.map((f) => f.path);
      expect(paths).toEqual(["app.ts"]); // only the subtree, no root.ts
      // changedFiles is scoped AND cwd-relative — "app.ts", not
      // "project/app.ts", and no unrelated "root.ts".
      expect(snapshot.changedFiles.map((c) => c.path)).toEqual(["app.ts"]);
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });
});
