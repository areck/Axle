import type { ExecutionPlan, PlannedStep } from "@axle/contracts";
import type { PackageManager, ProjectAnalysis } from "./analyze";

export interface PlanOptions {
  profile: string;
  timeoutSeconds: number;
}

/**
 * Turn a {@link ProjectAnalysis} into a verification plan using deterministic
 * rules: always install; then typecheck / lint / test / build for whichever
 * scripts exist. `lint` and `build` are non-blocking (required: false).
 */
export function planVerification(
  analysis: ProjectAnalysis,
  options: PlanOptions,
): ExecutionPlan {
  const { packageManager: pm, scripts, hasTypeScript } = analysis;
  const steps: PlannedStep[] = [
    step("install", installCommand(pm), options, true),
  ];

  if (scripts.typecheck) {
    steps.push(step("typecheck", runScript(pm, "typecheck"), options, true));
  }
  if (scripts.lint) {
    steps.push(step("lint", runScript(pm, "lint"), options, false));
  }
  if (scripts.test) {
    steps.push(step("test", testCommand(pm), options, true));
  }
  if (scripts.build) {
    steps.push(step("build", runScript(pm, "build"), options, false));
  }

  const names = steps.map((s) => s.name).join(" → ");
  return {
    profile: options.profile,
    steps,
    reason: `${pm} project${hasTypeScript ? " (TypeScript)" : ""}: ${names}`,
  };
}

/** A single-step plan for `axle verify --command "<cmd>"`. */
export function commandPlan(
  command: string,
  options: PlanOptions,
): ExecutionPlan {
  return {
    profile: options.profile,
    steps: [
      {
        id: "command",
        name: "command",
        command,
        timeoutSeconds: options.timeoutSeconds,
        required: true,
      },
    ],
    reason: "explicit --command",
  };
}

function step(
  name: string,
  command: string,
  options: PlanOptions,
  required: boolean,
): PlannedStep {
  return {
    id: name,
    name,
    command,
    timeoutSeconds: options.timeoutSeconds,
    required,
  };
}

function installCommand(pm: PackageManager): string {
  if (pm === "pnpm") return "pnpm install --frozen-lockfile";
  if (pm === "yarn") return "yarn install --frozen-lockfile";
  return "npm ci";
}

function testCommand(pm: PackageManager): string {
  if (pm === "pnpm") return "pnpm test";
  if (pm === "yarn") return "yarn test";
  return "npm test";
}

function runScript(pm: PackageManager, script: string): string {
  if (pm === "pnpm") return `pnpm run ${script}`;
  if (pm === "yarn") return `yarn ${script}`;
  return `npm run ${script}`;
}
