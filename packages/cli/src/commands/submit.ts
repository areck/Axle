import type {
  CreateExecutionRequest,
  Execution,
  ExecutionEvent,
} from "@axle/contracts";
import pc from "picocolors";
import { AxleClient } from "../client";
import {
  colorStatus,
  fail,
  field,
  formatDuration,
  renderDiagnostic,
  stepSymbol,
  symbols,
} from "../ui";

/**
 * The shared tail of the execution-submitting commands (`run`, `verify`):
 * connect to the API, create an execution, and stream it to completion.
 */

/** Build a client and fail fast with a friendly message if the API is down. */
export async function connect(api: string): Promise<AxleClient> {
  const client = new AxleClient(api);
  if (!(await client.health())) {
    fail(
      `Cannot reach the Axle API at ${api}. Start it with: ${pc.bold("pnpm dev")}`,
    );
  }
  return client;
}

/** Submit an execution and stream it to completion. */
export async function submitAndStream(
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
