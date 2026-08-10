import fs from "node:fs";
import path from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn";
export type TestFramework = "vitest" | "jest" | "mocha";

/**
 * A deterministic, LLM-free reading of a project directory — enough to plan a
 * verification. Node/TypeScript only for now.
 */
export interface ProjectAnalysis {
  packageManager: PackageManager;
  scripts: Record<string, string>;
  hasTypeScript: boolean;
  testFramework?: TestFramework;
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

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
  return {
    packageManager: detectPackageManager(root),
    scripts: pkg.scripts ?? {},
    hasTypeScript:
      fs.existsSync(path.join(root, "tsconfig.json")) || "typescript" in deps,
    testFramework: detectTestFramework(deps),
  };
}

function detectPackageManager(root: string): PackageManager {
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  return "npm"; // package-lock.json, or no lockfile
}

function detectTestFramework(
  deps: Record<string, string>,
): TestFramework | undefined {
  if ("vitest" in deps) return "vitest";
  if ("jest" in deps) return "jest";
  if ("mocha" in deps) return "mocha";
  return undefined;
}
