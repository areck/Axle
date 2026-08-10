import { resolveConfig } from "@axle/config";
import { Command } from "commander";
import {
  doctorCommand,
  executionsCommand,
  inspectCommand,
  runCommand,
  verifyCommand,
} from "./commands";
import { fail } from "./ui";

const AXLE_VERSION = "0.1.0";

async function main(): Promise<void> {
  const config = resolveConfig();
  const program = new Command();

  program
    .name("axle")
    .description("Axle — remote execution & verification for Agent Experience")
    .version(AXLE_VERSION)
    .option("--api <url>", "Axle API base URL", config.apiUrl);

  program
    .command("run")
    .argument("<command>", "command to run in an isolated execution")
    .description("Run a command in isolation and stream structured evidence")
    .option("--profile <name>", "execution profile", "node-22")
    .option("--timeout <seconds>", "step timeout in seconds", "600")
    .option("--intent <text>", "why you are running this")
    .option("--json", "print the final execution as JSON", false)
    .action(async (command, options, thisCommand) => {
      const api = thisCommand.optsWithGlobals().api as string;
      await runCommand(command, {
        api,
        profile: options.profile,
        timeout: Number(options.timeout),
        intent: options.intent,
        json: Boolean(options.json),
      });
    });

  program
    .command("verify")
    .description(
      "Capture the working tree, plan verification, and run it in isolation",
    )
    .option("--command <command>", "run a single command instead of a plan")
    .option("--profile <name>", "execution profile", "node-22")
    .option("--timeout <seconds>", "per-step timeout in seconds", "600")
    .option("--intent <text>", "why you are verifying")
    .option("--json", "print the final execution as JSON", false)
    .action(async (options, thisCommand) => {
      const api = thisCommand.optsWithGlobals().api as string;
      await verifyCommand({
        api,
        command: options.command,
        profile: options.profile,
        timeout: Number(options.timeout),
        intent: options.intent,
        json: Boolean(options.json),
      });
    });

  program
    .command("inspect")
    .argument("<executionId>", "execution id to inspect")
    .description("Show the full record for an execution")
    .option("--json", "print as JSON", false)
    .action(async (executionId, options, thisCommand) => {
      const api = thisCommand.optsWithGlobals().api as string;
      await inspectCommand(executionId, { api, json: Boolean(options.json) });
    });

  program
    .command("executions")
    .description("List recent executions")
    .option("--json", "print as JSON", false)
    .action(async (options, thisCommand) => {
      const api = thisCommand.optsWithGlobals().api as string;
      await executionsCommand({ api, json: Boolean(options.json) });
    });

  program
    .command("doctor")
    .description("Validate local prerequisites and connectivity")
    .action(async (options, thisCommand) => {
      const api = thisCommand.optsWithGlobals().api as string;
      await doctorCommand({ api });
    });

  await program.parseAsync(process.argv);
}

main().catch((error) =>
  fail(error instanceof Error ? error.message : String(error)),
);
