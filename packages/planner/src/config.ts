import fs from "node:fs";
import path from "node:path";
import {
  type ExecutionPlan,
  type PlannedStep,
  VERIFY_CONFIG_FILENAMES,
  type VerifyConfig,
  VerifyConfigSchema,
} from "@axle/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ProjectAnalysis } from "./analyze";
import { planVerification } from "./plan";

export interface LoadedVerifyConfig {
  config: VerifyConfig;
  /** Absolute path of the file the config was read from. */
  path: string;
}

/**
 * Load and validate `axle.yaml` (or `axle.yml`) from `cwd`. Returns `null` when
 * no config file is present; throws a clear error when one exists but is
 * malformed YAML or fails schema validation.
 */
export function loadVerifyConfig(cwd: string): LoadedVerifyConfig | null {
  for (const name of VERIFY_CONFIG_FILENAMES) {
    const file = path.join(cwd, name);
    if (!fs.existsSync(file)) continue;

    let raw: unknown;
    try {
      raw = parseYaml(fs.readFileSync(file, "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not parse ${name}: ${message}`);
    }

    const parsed = VerifyConfigSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      throw new Error(`Invalid ${name}:\n${issues}`);
    }
    return { config: parsed.data, path: file };
  }
  return null;
}

/**
 * Turn an {@link VerifyConfig} into an execution plan. The config is
 * authoritative: its steps run exactly as written, in order.
 */
export function planFromConfig(config: VerifyConfig): ExecutionPlan {
  const usedIds = new Set<string>();
  const steps: PlannedStep[] = config.steps.map((step) => ({
    id: uniqueSlug(step.name, usedIds),
    name: step.name,
    command: step.command,
    timeoutSeconds: step.timeoutSeconds,
    required: step.required,
  }));
  const names = config.steps.map((s) => s.name).join(" → ");
  return {
    profile: config.profile,
    steps,
    reason: `axle.yaml: ${names}`,
  };
}

/**
 * A best-effort `axle.yaml` derived from auto-detection, serialized to YAML.
 * Used by `axle init --write` and as the starting point in the init prompt.
 */
export function suggestedConfigYaml(analysis: ProjectAnalysis): string {
  return stringifyYaml(suggestedConfig(analysis));
}

/** The detected plan expressed as a {@link VerifyConfig}. */
export function suggestedConfig(analysis: ProjectAnalysis): VerifyConfig {
  const plan = planVerification(analysis, {
    profile: "node-22",
    timeoutSeconds: 600,
  });
  return {
    profile: plan.profile,
    steps: plan.steps.map((s) => ({
      name: s.name,
      command: s.command,
      required: s.required,
      timeoutSeconds: s.timeoutSeconds,
    })),
  };
}

function uniqueSlug(name: string, used: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "step";
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}
