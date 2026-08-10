import fs from "node:fs/promises";
import path from "node:path";
import type {
  ChangeSnapshot,
  ChangedFile,
  SnapshotFile,
} from "@axle/contracts";
import { headSha, isGitRepo, listFiles, statusPorcelain } from "./git";
import { buildIgnoreFilter } from "./ignore";

const PER_FILE_MAX_BYTES = 1024 * 1024; // 1 MiB — skip large blobs
const TOTAL_MAX_BYTES = 20 * 1024 * 1024; // 20 MiB — under the API's 25 MB body limit
const MAX_FILES = 5000;

/**
 * Capture the current working-tree state under `cwd` as a self-contained
 * {@link ChangeSnapshot}: the materialized files themselves (no patch, no base
 * tree), plus `baseSha`/`changedFiles` provenance. Git scopes to `cwd`, so this
 * captures exactly the project the command was invoked in.
 */
export async function captureWorkspace(cwd: string): Promise<ChangeSnapshot> {
  if (!(await isGitRepo(cwd))) {
    throw new Error(
      `Not a git repository: ${cwd}. \`axle verify\` needs a git working tree.`,
    );
  }

  const baseSha = await headSha(cwd);
  const ignored = await buildIgnoreFilter(cwd);
  const candidates = (await listFiles(cwd)).filter((rel) => !ignored(rel));

  if (candidates.length > MAX_FILES) {
    throw new Error(
      `Workspace has ${candidates.length} files (limit ${MAX_FILES}). Add a .axleignore to exclude generated files.`,
    );
  }

  const files: SnapshotFile[] = [];
  let totalBytes = 0;
  for (const rel of candidates) {
    const abs = path.join(cwd, rel);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(abs);
    } catch {
      continue; // deleted or unreadable — reproduce as absent
    }
    if (!stat.isFile() || stat.size > PER_FILE_MAX_BYTES) continue;

    totalBytes += stat.size;
    if (totalBytes > TOTAL_MAX_BYTES) {
      const limitMiB = TOTAL_MAX_BYTES / (1024 * 1024);
      throw new Error(
        `Workspace snapshot exceeds ${limitMiB} MiB. Add a .axleignore to exclude large or generated files.`,
      );
    }

    const buffer = await fs.readFile(abs);
    files.push({
      path: rel.split(path.sep).join("/"),
      contentBase64: buffer.toString("base64"),
      mode: stat.mode & 0o777,
      sizeBytes: stat.size,
    });
  }

  const changedFiles = parseChangedFiles(await statusPorcelain(cwd));
  return { baseSha, changedFiles, files };
}

function parseChangedFiles(porcelain: string): ChangedFile[] {
  const changed: ChangedFile[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.length < 4) continue;
    const code = line[0] === " " ? line[1] : line[0];
    const rest = line.slice(3);
    if (code === "?" || code === "A") {
      changed.push({ path: rest, changeType: "added" });
    } else if (code === "D") {
      changed.push({ path: rest, changeType: "deleted" });
    } else if (code === "R") {
      const [oldPath, newPath] = rest.split(" -> ");
      changed.push({
        path: newPath ?? rest,
        changeType: "renamed",
        oldPath,
      });
    } else {
      changed.push({ path: rest, changeType: "modified" });
    }
  }
  return changed;
}
