import path from "node:path";
import type { CreateExecutionRequest } from "@axle/contracts";
import { commandPlan } from "@axle/planner";
import { field, heading } from "../ui";
import { connect, submitAndStream } from "./submit";

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
