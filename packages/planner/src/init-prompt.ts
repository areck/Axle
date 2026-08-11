import type { VerifyConfig } from "@axle/contracts";
import { stringify as stringifyYaml } from "yaml";
import type { ProjectAnalysis } from "./analyze";
import { suggestedConfigYaml } from "./config";

/**
 * Build the instruction prompt that an enclosing coding agent follows to author
 * an `axle.yaml` for the current repository.
 *
 * Axle Verify runs inside an agent's workflow, so the fastest way to a correct,
 * repo-specific config is to hand the agent — which can already read the tree,
 * CI files, and docs — a precise brief plus an auto-detected starting point.
 * `axle init` prints this to stdout for exactly that purpose.
 */
export function buildInitPrompt(
  analysis: ProjectAnalysis,
  existing?: VerifyConfig,
): string {
  const detected = [
    `package manager: ${analysis.packageManager}${analysis.hasLockfile ? " (lockfile present)" : " (no lockfile)"}`,
    `TypeScript: ${analysis.hasTypeScript ? "yes" : "no"}`,
    `package.json scripts: ${
      Object.keys(analysis.scripts).length > 0
        ? Object.keys(analysis.scripts).join(", ")
        : "(none)"
    }`,
  ]
    .map((line) => `- ${line}`)
    .join("\n");

  const startingPoint = existing
    ? `This repository already has an axle.yaml. Review and improve it — its current contents are:\n\n\`\`\`yaml\n${stringifyYaml(existing).trimEnd()}\n\`\`\``
    : `Axle auto-detected a starting point (refine it against the repository — do not assume it is complete or correct):\n\n\`\`\`yaml\n${suggestedConfigYaml(analysis).trimEnd()}\n\`\`\``;

  return `# Task: write \`axle.yaml\` for this repository

You are configuring Axle Verify for the repository in the current working
directory by writing an \`axle.yaml\` file at its root.

## What axle.yaml is
Axle verifies an uncommitted change by running an ordered list of steps in a
clean, isolated environment and returning structured evidence (pass/fail per
step, diagnostics, and logs). \`axle.yaml\` declares those steps. When it is
present it REPLACES Axle's auto-detection, so it must be complete and correct
for this repository on its own.

## Schema
\`\`\`yaml
profile: node-22          # execution environment; keep node-22 unless the repo needs otherwise
steps:                    # ordered; each runs in the same prepared workspace, top to bottom
  - name: install         # short label
    command: npm ci       # the exact shell command
    required: true        # a failure here fails verification (default: true)
    timeoutSeconds: 600   # per-step wall-clock budget (default: 600)
\`\`\`

## How to author it
Inspect the repository and produce steps that match how THIS project is really
built and tested — the goal is that a green \`axle verify\` means the change is
sound.
1. Detect the package manager from the lockfile (pnpm-lock.yaml → pnpm,
   yarn.lock → yarn, package-lock.json → npm) and use it consistently.
2. Read \`package.json\` scripts, and check for a Makefile / justfile /
   Taskfile, CI workflows (\`.github/workflows/*\`), and any "Development" or
   "Testing" section of the README. CI config is the best source of truth for
   the real verification commands.
3. Emit steps in this order, including only those that apply:
   - install (required) — dependency install for the detected package manager;
     use the frozen/locked form (\`npm ci\`, \`pnpm install --frozen-lockfile\`)
     only when a lockfile is committed.
   - typecheck (required) — e.g. \`tsc --noEmit\`, if the project uses TypeScript.
   - lint (required: false) — the project's linter, non-blocking.
   - test (required) — the CI test command, non-interactive (e.g. \`vitest run\`,
     \`jest --ci\`, \`pytest -q\`). Never a watch mode.
   - build (required: false) — the production build, if one exists.
   - Any other checks the project's CI runs (e.g. e2e), with sensible flags.
4. Use non-interactive, CI-safe commands: no watch mode, no prompts. Set
   \`CI=true\` in a command when a tool needs it.
5. Do NOT include deploy, publish, release, or any step that needs secrets or
   network credentials — verification runs on the change, nothing more.
6. Give slow steps (e2e, full builds) a larger \`timeoutSeconds\`.

## Detected context
${detected}

${startingPoint}

## Output
Write the final YAML to \`axle.yaml\` at the repository root. Then run
\`axle verify\` and confirm the plan runs and the required steps pass.
`;
}
