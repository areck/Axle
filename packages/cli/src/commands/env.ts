import type { Environment } from "@axle/contracts";
import pc from "picocolors";
import { AxleClient } from "../client";
import { fail, field, heading } from "../ui";

export interface EnvSetOptions {
  api: string;
  var: string[];
  secret: string[];
  json: boolean;
}

/**
 * `axle env set <name> --var K=V --secret K=V|K` — upsert variables/secrets.
 *
 * A `--secret KEY` with no value reads it from the CLI's own environment
 * ($KEY), so secret values need not appear on the command line (and in shell
 * history). Secret values are sent to the control plane and never returned.
 */
export async function envSetCommand(
  name: string,
  options: EnvSetOptions,
): Promise<void> {
  const variables: Record<string, string> = {};
  for (const assignment of options.var) {
    const eq = assignment.indexOf("=");
    if (eq <= 0) fail(`--var expects KEY=VALUE, got "${assignment}"`);
    variables[assignment.slice(0, eq)] = assignment.slice(eq + 1);
  }

  const secrets: Record<string, string> = {};
  for (const assignment of options.secret) {
    const eq = assignment.indexOf("=");
    if (eq > 0) {
      secrets[assignment.slice(0, eq)] = assignment.slice(eq + 1);
      continue;
    }
    const value = process.env[assignment];
    if (value === undefined) {
      fail(
        `--secret ${assignment} has no value and $${assignment} is not set in your environment.`,
      );
    }
    secrets[assignment] = value;
  }

  if (
    Object.keys(variables).length === 0 &&
    Object.keys(secrets).length === 0
  ) {
    fail("Nothing to set. Pass --var KEY=VALUE and/or --secret KEY[=VALUE].");
  }

  const client = new AxleClient(options.api);
  const environment = await client.setEnvironment(name, { variables, secrets });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(environment, null, 2)}\n`);
  } else {
    renderEnvironment(environment);
  }
}

export async function envListCommand(options: {
  api: string;
  json: boolean;
}): Promise<void> {
  const client = new AxleClient(options.api);
  const environments = await client.listEnvironments();
  if (options.json) {
    process.stdout.write(`${JSON.stringify(environments, null, 2)}\n`);
    return;
  }
  if (environments.length === 0) {
    process.stdout.write(
      `No environments yet. Create one: ${pc.bold("axle env set <name> --var KEY=VALUE")}\n`,
    );
    return;
  }
  heading(`Environments (${environments.length})`);
  for (const env of environments) {
    const vars = Object.keys(env.variables).length;
    const secrets = env.secretNames.length;
    process.stdout.write(
      `  ${pc.bold(env.name.padEnd(16))} ${pc.dim(
        `${vars} var${vars === 1 ? "" : "s"}, ${secrets} secret${secrets === 1 ? "" : "s"}`,
      )}  ${pc.dim(env.updatedAt)}\n`,
    );
  }
  process.stdout.write("\n");
}

export async function envGetCommand(
  name: string,
  options: { api: string; json: boolean },
): Promise<void> {
  const client = new AxleClient(options.api);
  const environment = await client.getEnvironment(name);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(environment, null, 2)}\n`);
  } else {
    renderEnvironment(environment);
  }
}

export async function envDeleteCommand(
  name: string,
  options: { api: string },
): Promise<void> {
  const client = new AxleClient(options.api);
  if (!(await client.deleteEnvironment(name))) {
    fail(`Environment "${name}" not found.`);
  }
  heading("Environment");
  field("Deleted", name);
  process.stdout.write("\n");
}

function renderEnvironment(env: Environment): void {
  heading(`Environment ${env.name}`);
  const varKeys = Object.keys(env.variables).sort();
  if (varKeys.length > 0) {
    process.stdout.write(`\n  ${pc.bold("Variables")}\n`);
    for (const key of varKeys) {
      field(`  ${key}`, env.variables[key] ?? "");
    }
  }
  if (env.secretNames.length > 0) {
    process.stdout.write(`\n  ${pc.bold("Secrets")}\n`);
    for (const key of [...env.secretNames].sort()) {
      field(`  ${key}`, pc.dim("(set)"));
    }
  }
  if (varKeys.length === 0 && env.secretNames.length === 0) {
    process.stdout.write(`  ${pc.dim("(no variables or secrets)")}\n`);
  }
  process.stdout.write("\n");
}
