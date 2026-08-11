import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveConfig } from "@axle/config";
import pc from "picocolors";
import { AxleClient } from "../client";
import { field, heading, symbols } from "../ui";

const execFileAsync = promisify(execFile);

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
