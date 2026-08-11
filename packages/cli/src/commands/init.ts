import fs from "node:fs/promises";
import path from "node:path";
import {
  analyzeProject,
  buildInitPrompt,
  loadVerifyConfig,
  suggestedConfigYaml,
} from "@axle/planner";
import pc from "picocolors";
import { fail, field, heading } from "../ui";

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
