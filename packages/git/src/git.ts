import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Run a git command in `cwd` and return its stdout. Git scopes to the working
 * directory, which is what lets `axle verify` capture just the project subtree
 * it is invoked in (even inside a larger monorepo).
 */
async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--is-inside-work-tree"], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function repoRoot(cwd: string): Promise<string> {
  return (await git(["rev-parse", "--show-toplevel"], cwd)).trim();
}

/**
 * The path from the repository root down to `cwd`, with a trailing slash (e.g.
 * `examples/app/`), or `""` at the root. `git status --porcelain` reports paths
 * relative to the repo root, so this is what we strip to make them relative to
 * `cwd` — matching `listFiles`.
 */
export async function showPrefix(cwd: string): Promise<string> {
  return (await git(["rev-parse", "--show-prefix"], cwd)).trim();
}

export async function headSha(cwd: string): Promise<string> {
  try {
    return (await git(["rev-parse", "HEAD"], cwd)).trim();
  } catch {
    return "0000000"; // repository has no commits yet
  }
}

/**
 * Tracked + untracked files under `cwd` (respecting .gitignore via
 * `--exclude-standard`), as paths relative to `cwd`.
 */
export async function listFiles(cwd: string): Promise<string[]> {
  const out = await git(
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    cwd,
  );
  return out.split("\0").filter((entry) => entry.length > 0);
}

/**
 * Working-tree changes under `cwd`, as `git status --porcelain` lines. The
 * `-- .` pathspec scopes the status to the invocation subtree so `changedFiles`
 * stays consistent with the (subtree-scoped) captured files, rather than
 * leaking unrelated changes from elsewhere in a larger monorepo.
 */
export async function statusPorcelain(cwd: string): Promise<string> {
  return git(["status", "--porcelain", "--", "."], cwd);
}
