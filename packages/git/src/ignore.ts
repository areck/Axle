import fs from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";

/**
 * Files excluded from a snapshot even if git would track them. `.gitignore` is
 * already handled by git itself (`--exclude-standard`); this is the extra layer
 * that keeps secrets out by default.
 */
const SECRET_DENYLIST = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.keystore",
  "*_rsa",
  "*_dsa",
  "*_ed25519",
  "id_rsa*",
  "**/.ssh/**",
  "**/secrets/**",
  ".npmrc",
];

export type IgnoreFilter = (relativePath: string) => boolean;

/**
 * Build the exclusion filter for a workspace: the built-in secret denylist plus
 * an optional `.axleignore` (gitignore syntax) at the capture root.
 */
export async function buildIgnoreFilter(cwd: string): Promise<IgnoreFilter> {
  const ig: Ignore = ignore().add(SECRET_DENYLIST);
  try {
    const axleignore = await fs.readFile(path.join(cwd, ".axleignore"), "utf8");
    ig.add(axleignore);
  } catch {
    // No .axleignore — the denylist alone applies.
  }
  return (relativePath) => ig.ignores(relativePath);
}
