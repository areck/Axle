import path from "node:path";
import type { CreateExecutionRequest, ExecutionPlan } from "@axle/contracts";
import { captureWorkspace, isGitRepo } from "@axle/git";
import {
  analyzeProject,
  commandPlan,
  loadVerifyConfig,
  planFromConfig,
  planVerification,
} from "@axle/planner";
import { fail, field, heading, renderPlan } from "../ui";
import { connect, submitAndStream } from "./submit";

export interface VerifyOptions {
  api: string;
  profile: string;
  timeout: number;
  intent?: string;
  environment?: string;
  json: boolean;
  command?: string;
}

export async function verifyCommand(options: VerifyOptions): Promise<void> {
  const client = await connect(options.api);

  const cwd = process.cwd();
  if (!(await isGitRepo(cwd))) {
    fail(
      "`axle verify` must run inside a git repository — it captures the working tree.",
    );
  }

  const snapshot = await captureWorkspace(cwd);
  const { plan, environment } = resolvePlan(cwd, options);

  const request: CreateExecutionRequest = {
    repository: { name: path.basename(cwd) },
    change: snapshot,
    intent: options.intent,
    profile: { name: options.profile },
    environment,
    plan,
  };

  if (!options.json) {
    heading("Verify");
    field("Repository", path.basename(cwd));
    field("Base", snapshot.baseSha.slice(0, 7));
    field("Changed files", String(snapshot.changedFiles.length));
    if (environment) field("Environment", environment);
    if (plan.reason) field("Project", plan.reason);
    renderPlan(plan);
  }

  await submitAndStream(client, request, options.json);
}

/**
 * Resolve the plan and the environment to run it in.
 *
 * Plan precedence: an explicit `--command`, then a project `axle.yaml`, then
 * auto-detection (only this path needs a recognizable Node project — `axle.yaml`
 * lets any project verify). Environment precedence: the `--env` flag, then
 * `axle.yaml`'s `environment`.
 */
function resolvePlan(
  cwd: string,
  options: VerifyOptions,
): { plan: ExecutionPlan; environment?: string } {
  const planOptions = {
    profile: options.profile,
    timeoutSeconds: options.timeout,
  };
  if (options.command) {
    return {
      plan: commandPlan(options.command, planOptions),
      environment: options.environment,
    };
  }
  const configured = loadVerifyConfig(cwd);
  if (configured) {
    return {
      plan: planFromConfig(configured.config),
      environment: options.environment ?? configured.config.environment,
    };
  }
  return {
    plan: planVerification(analyzeProject(cwd), planOptions),
    environment: options.environment,
  };
}
