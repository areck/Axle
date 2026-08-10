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
  const plan = resolveVerifyPlan(cwd, options);

  const request: CreateExecutionRequest = {
    repository: { name: path.basename(cwd) },
    change: snapshot,
    intent: options.intent,
    profile: { name: options.profile },
    plan,
  };

  if (!options.json) {
    heading("Verify");
    field("Repository", path.basename(cwd));
    field("Base", snapshot.baseSha.slice(0, 7));
    field("Changed files", String(snapshot.changedFiles.length));
    if (plan.reason) field("Project", plan.reason);
    renderPlan(plan);
  }

  await submitAndStream(client, request, options.json);
}

/**
 * Choose the verification plan, in precedence order: an explicit `--command`,
 * then a project `axle.yaml`, then auto-detection. Only the auto-detect path
 * requires a recognizable Node project — `axle.yaml` lets any project verify.
 */
function resolveVerifyPlan(cwd: string, options: VerifyOptions): ExecutionPlan {
  const planOptions = {
    profile: options.profile,
    timeoutSeconds: options.timeout,
  };
  if (options.command) return commandPlan(options.command, planOptions);
  const configured = loadVerifyConfig(cwd);
  if (configured) return planFromConfig(configured.config);
  return planVerification(analyzeProject(cwd), planOptions);
}
