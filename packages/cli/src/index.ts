import { resolveConfig } from "@axle/config";
import { Command } from "commander";
import {
  createUserCommand,
  doctorCommand,
  envDeleteCommand,
  envGetCommand,
  envListCommand,
  envSetCommand,
  executionsCommand,
  initCommand,
  inspectCommand,
  loginCommand,
  runCommand,
  verifyCommand,
  whoamiCommand,
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
    .option("--env <name>", "environment whose vars/secrets Axle injects")
    .option("--json", "print the final execution as JSON", false)
    .action(async (command, options, thisCommand) => {
      const api = thisCommand.optsWithGlobals().api as string;
      await runCommand(command, {
        api,
        profile: options.profile,
        timeout: Number(options.timeout),
        intent: options.intent,
        environment: options.env,
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
    .option(
      "--env <name>",
      "environment whose vars/secrets Axle injects (overrides axle.yaml)",
    )
    .option("--json", "print the final execution as JSON", false)
    .action(async (options, thisCommand) => {
      const api = thisCommand.optsWithGlobals().api as string;
      await verifyCommand({
        api,
        command: options.command,
        profile: options.profile,
        timeout: Number(options.timeout),
        intent: options.intent,
        environment: options.env,
        json: Boolean(options.json),
      });
    });

  program
    .command("init")
    .description(
      "Configure axle.yaml — print an agent prompt to author it, or --write a scaffold",
    )
    .option(
      "--write",
      "write a detected axle.yaml scaffold instead of a prompt",
      false,
    )
    .option("--force", "overwrite an existing axle.yaml (with --write)", false)
    .action(async (options) => {
      await initCommand({
        write: Boolean(options.write),
        force: Boolean(options.force),
      });
    });

  program
    .command("login")
    .description("Sign in with email/password and store an API key")
    .requiredOption("--email <email>", "account email")
    .requiredOption("--password <password>", "account password")
    .option("--json", "print as JSON", false)
    .action(async (options, thisCommand) => {
      const api = thisCommand.optsWithGlobals().api as string;
      await loginCommand({
        api,
        email: options.email,
        password: options.password,
        json: Boolean(options.json),
      });
    });

  const auth = program.command("auth").description("Manage identities & roles");

  auth
    .command("whoami")
    .description("Show the current identity and role")
    .option("--json", "print as JSON", false)
    .action(async (options, thisCommand) => {
      const api = thisCommand.optsWithGlobals().api as string;
      await whoamiCommand({ api, json: Boolean(options.json) });
    });

  auth
    .command("create-user")
    .description("Provision a user (admin only)")
    .requiredOption("--email <email>", "new user's email")
    .requiredOption("--password <password>", "new user's password")
    .option("--role <role>", "admin or member", "member")
    .option("--json", "print as JSON", false)
    .action(async (options, thisCommand) => {
      const api = thisCommand.optsWithGlobals().api as string;
      await createUserCommand({
        api,
        email: options.email,
        password: options.password,
        role: options.role,
        json: Boolean(options.json),
      });
    });

  const collect = (value: string, previous: string[]): string[] => [
    ...previous,
    value,
  ];

  const env = program
    .command("env")
    .description("Manage environments & secrets (control-plane config)");

  env
    .command("set <name>")
    .description("Create or update an environment's variables and secrets")
    .option(
      "--var <KEY=VALUE>",
      "non-secret variable (repeatable)",
      collect,
      [],
    )
    .option(
      "--secret <KEY=VALUE>",
      "secret value; KEY alone reads $KEY from your env (repeatable)",
      collect,
      [],
    )
    .option("--json", "print as JSON", false)
    .action(async (name, options, thisCommand) => {
      const api = thisCommand.optsWithGlobals().api as string;
      await envSetCommand(name, {
        api,
        var: options.var,
        secret: options.secret,
        json: Boolean(options.json),
      });
    });

  env
    .command("list")
    .description("List environments")
    .option("--json", "print as JSON", false)
    .action(async (options, thisCommand) => {
      const api = thisCommand.optsWithGlobals().api as string;
      await envListCommand({ api, json: Boolean(options.json) });
    });

  env
    .command("get <name>")
    .description("Show an environment's variables and secret names")
    .option("--json", "print as JSON", false)
    .action(async (name, options, thisCommand) => {
      const api = thisCommand.optsWithGlobals().api as string;
      await envGetCommand(name, { api, json: Boolean(options.json) });
    });

  env
    .command("delete <name>")
    .description("Delete an environment")
    .action(async (name, _options, thisCommand) => {
      const api = thisCommand.optsWithGlobals().api as string;
      await envDeleteCommand(name, { api });
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
