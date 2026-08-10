import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { resolveConfig } from "@axle/config";
import type {
  CreateExecutionRequest,
  Execution,
  ExecutionEvent,
  ExecutionStatus,
} from "@axle/contracts";
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

export async function runCommand(
  command: string,
  options: RunOptions,
): Promise<void> {
  const client = new AxleClient(options.api);
  if (!(await client.health())) {
    fail(
      `Cannot reach the Axle API at ${options.api}. Start it with: ${pc.bold("pnpm dev")}`,
    );
  }

  const request: CreateExecutionRequest = {
    repository: { name: path.basename(process.cwd()) },
    profile: { name: options.profile },
    intent: options.intent,
    plan: {
      profile: options.profile,
      steps: [
        {
          id: "cmd",
          name: "command",
          command,
          timeoutSeconds: options.timeout,
          required: true,
        },
      ],
    },
  };

  const execution = await client.createExecution(request);

  if (!options.json) {
    heading("Run");
    field("Execution", execution.id);
    field("Profile", options.profile);
    field("Command", command);
  }

  await streamExecution(client, execution.id, options.json);
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
