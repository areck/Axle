import fs from "node:fs";
import path from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn";

/**
 * A deterministic, LLM-free reading of a project directory — enough to plan a
 * verification. Node/TypeScript only for now.
 */
export interface ProjectAnalysis {
  packageManager: PackageManager;
  /** Whether a lockfile exists for the detected package manager. */
  hasLockfile: boolean;
  scripts: Record<string, string>;
  hasTypeScript: boolean;
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const LOCKFILES: Record<PackageManager, string[]> = {
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
  npm: ["package-lock.json", "npm-shrinkwrap.json"],
};

export function analyzeProject(root: string): ProjectAnalysis {
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    ) as PackageJson;
  } catch {
    throw new Error(
      `No package.json in ${root} — \`axle verify\` currently supports Node projects.`,
    );
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const packageManager = detectPackageManager(root);
  return {
    packageManager,
    hasLockfile: LOCKFILES[packageManager].some((f) =>
      fs.existsSync(path.join(root, f)),
    ),
    scripts: pkg.scripts ?? {},
    hasTypeScript:
      fs.existsSync(path.join(root, "tsconfig.json")) || "typescript" in deps,
  };
}

function detectPackageManager(root: string): PackageManager {
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  return "npm"; // package-lock.json, or no lockfile
}
