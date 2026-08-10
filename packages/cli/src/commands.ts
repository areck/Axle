import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveConfig } from "@axle/config";
import type {
  CreateExecutionRequest,
  Execution,
  ExecutionEvent,
  ExecutionPlan,
  ExecutionStatus,
} from "@axle/contracts";
import { captureWorkspace, isGitRepo } from "@axle/git";
import {
  analyzeProject,
  buildInitPrompt,
  commandPlan,
  loadVerifyConfig,
  planFromConfig,
  planVerification,
  suggestedConfigYaml,
} from "@axle/planner";
import pc from "picocolors";
import { AxleClient } from "./client";
import {
  colorStatus,
  fail,
  field,
  formatDuration,
  heading,
  renderDiagnostic,
  renderExecutionDetail,
  renderPlan,
  stepSymbol,
  symbols,
} from "./ui";

const execFileAsync = promisify(execFile);

export interface RunOptions {
  api: string;
  profile: string;
  timeout: number;
  intent?: string;
  json: boolean;
}

export interface VerifyOptions {
  api: string;
  profile: string;
  timeout: number;
  intent?: string;
  json: boolean;
  command?: string;
}

export async function runCommand(
  command: string,
  options: RunOptions,
): Promise<void> {
  const client = await connect(options.api);

  const request: CreateExecutionRequest = {
    repository: { name: path.basename(process.cwd()) },
    profile: { name: options.profile },
    intent: options.intent,
    plan: commandPlan(command, {
      profile: options.profile,
      timeoutSeconds: options.timeout,
    }),
  };

  if (!options.json) {
    heading("Run");
    field("Profile", options.profile);
    field("Command", command);
  }

  await submitAndStream(client, request, options.json);
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

export interface InitOptions {
  /** Write a scaffold axle.yaml instead of printing the agent prompt. */
  write: boolean;
  /** Overwrite an existing axle.yaml (only with --write). */
  force: boolean;
}

/**
 * Configure `axle.yaml` for the project in the current directory.
 *
 * Default (agentic) path: print an instruction prompt for the enclosing agent
 * to author the config from the repo. `--write` instead drops a deterministic,
 * auto-detected scaffold to disk for projects that just want a starting file.
 */
export async function initCommand(options: InitOptions): Promise<void> {
  const cwd = process.cwd();
  // Surfaces a clear error if an existing axle.yaml is malformed.
  const existing = loadVerifyConfig(cwd);

  if (options.write) {
    const target = path.join(cwd, "axle.yaml");
    if (existing && !options.force) {
      fail(
        `axle.yaml already exists at ${existing.path}. Edit it directly, or re-run with --force to overwrite.`,
      );
    }
    await fs.writeFile(target, suggestedConfigYaml(analyzeProject(cwd)));
    heading("Init");
    field("Wrote", target);
    process.stdout.write(
      `\n  Review the steps, then run ${pc.bold("axle verify")}.\n\n`,
    );
    return;
  }

  // Agentic path: emit the prompt for the enclosing agent to act on.
  process.stdout.write(buildInitPrompt(analyzeProject(cwd), existing?.config));
  process.stdout.write("\n");
}

export async function inspectCommand(
  executionId: string,
  options: { api: string; json: boolean },
): Promise<void> {
  const client = new AxleClient(options.api);
  const execution = await client.getExecution(executionId);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(execution, null, 2)}\n`);
  } else {
    renderExecutionDetail(execution);
  }
}

export async function executionsCommand(options: {
  api: string;
  json: boolean;
}): Promise<void> {
  const client = new AxleClient(options.api);
  const { executions, total } = await client.listExecutions();
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ executions, total }, null, 2)}\n`);
    return;
  }
  if (executions.length === 0) {
    process.stdout.write(
      `No executions yet. Try: ${pc.bold('axle run "echo hello"')}\n`,
    );
    return;
  }
  heading(`Executions (${total})`);
  for (const summary of executions) {
    const duration = pc.dim(formatDuration(summary.durationMs).padStart(7));
    process.stdout.write(
      `  ${statusSymbol(summary.status)} ${pc.dim(summary.id)}  ` +
        `${colorStatus(summary.status)}  ${duration}  ` +
        `${pc.dim(`${summary.stepCount} steps`)}  ${pc.dim(summary.createdAt)}\n`,
    );
  }
  process.stdout.write("\n");
}

export async function doctorCommand(options: { api: string }): Promise<void> {
  heading("Doctor");

  const git = await commandSucceeds("git", ["--version"]);
  reportCheck(git, "git", git ? "installed" : "not found");

  const dockerDaemon = await commandSucceeds("docker", ["info"]);
  reportCheck(
    dockerDaemon,
    "docker daemon",
    dockerDaemon ? "running" : "not running (LocalRuntime will be used)",
  );

  const inRepo = await commandSucceeds("git", [
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  reportCheck(
    inRepo,
    "git repository",
    inRepo ? process.cwd() : "current directory is not a git repo",
  );

  const client = new AxleClient(options.api);
  const apiUp = await client.health();
  reportCheck(
    apiUp,
    "axle api",
    apiUp ? options.api : `unreachable at ${options.api} (run: pnpm dev)`,
  );

  const config = resolveConfig();
  const selected =
    config.runtime === "auto"
      ? dockerDaemon
        ? "docker"
        : "local"
      : config.runtime;
  field(
    "Runtime",
    selected === "local"
      ? pc.yellow("local (no isolation — development only)")
      : selected,
  );
  process.stdout.write("\n");
}

// --- helpers ---------------------------------------------------------------

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

/** Build a client and fail fast with a friendly message if the API is down. */
async function connect(api: string): Promise<AxleClient> {
  const client = new AxleClient(api);
  if (!(await client.health())) {
    fail(
      `Cannot reach the Axle API at ${api}. Start it with: ${pc.bold("pnpm dev")}`,
    );
  }
  return client;
}

/** Submit an execution and stream it to completion — the shared tail of
 * `axle run` and `axle verify`. */
async function submitAndStream(
  client: AxleClient,
  request: CreateExecutionRequest,
  json: boolean,
): Promise<void> {
  const execution = await client.createExecution(request);
  if (!json) field("Execution", execution.id);
  await streamExecution(client, execution.id, json);
}

async function streamExecution(
  client: AxleClient,
  id: string,
  json: boolean,
): Promise<void> {
  for await (const event of client.streamEvents(id)) {
    if (!json) renderEvent(event);
  }
  const execution = await client.getExecution(id);
  if (json) {
    process.stdout.write(`${JSON.stringify(execution, null, 2)}\n`);
  } else {
    renderRunSummary(execution);
  }
  if (execution.status !== "succeeded") {
    process.exitCode = 1;
  }
}

function renderEvent(event: ExecutionEvent): void {
  switch (event.type) {
    case "step.started":
      process.stdout.write(
        `\n${symbols.run} ${pc.bold(event.name)} ${pc.dim(`$ ${event.command}`)}\n`,
      );
      break;
    case "step.output":
      process.stdout.write(event.data);
      break;
    case "step.completed": {
      const exit =
        event.exitCode !== null ? pc.dim(` (exit ${event.exitCode})`) : "";
      process.stdout.write(
        `${stepSymbol(event.status)} ${pc.dim(event.status)} ${pc.dim(
          formatDuration(event.durationMs),
        )}${exit}\n`,
      );
      break;
    }
    default:
      break;
  }
}

function renderRunSummary(execution: Execution): void {
  process.stdout.write("\n");
  field("Result", colorStatus(execution.status));
  field("Duration", formatDuration(execution.metrics.totalDurationMs));

  if (execution.diagnostics.length > 0) {
    process.stdout.write(`\n  ${pc.bold("Diagnostics")}\n`);
    for (const diagnostic of execution.diagnostics) {
      process.stdout.write(`${renderDiagnostic(diagnostic)}\n`);
    }
  }

  if (execution.artifacts.length > 0) {
    process.stdout.write(`\n  ${pc.bold("Artifacts")}\n`);
    for (const artifact of execution.artifacts) {
      process.stdout.write(`  ${symbols.ok} ${artifact.name}\n`);
    }
  }

  process.stdout.write(
    `\n  ${pc.dim("Inspect:")} ${pc.bold(`axle inspect ${execution.id}`)}\n\n`,
  );
}

function statusSymbol(status: ExecutionStatus): string {
  switch (status) {
    case "succeeded":
      return symbols.ok;
    case "failed":
      return symbols.fail;
    case "cancelled":
      return symbols.skip;
    case "running":
    case "provisioning":
      return symbols.run;
    default:
      return symbols.pending;
  }
}

function reportCheck(ok: boolean, label: string, detail: string): void {
  const symbol = ok ? symbols.ok : symbols.fail;
  process.stdout.write(`  ${symbol} ${label.padEnd(16)} ${pc.dim(detail)}\n`);
}

async function commandSucceeds(cmd: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(cmd, args, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
