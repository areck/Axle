import type { ExecutionStatus } from "@axle/contracts";
import pc from "picocolors";
import { AxleClient } from "../client";
import { colorStatus, formatDuration, heading, symbols } from "../ui";

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
