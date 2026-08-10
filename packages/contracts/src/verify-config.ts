import { z } from "zod";

/**
 * The `axle.yaml` project file: how a repository wants its changes verified.
 *
 * When present at the root of the project being verified, it *replaces* Axle's
 * auto-detection — the author (a human, or the enclosing agent via `axle init`)
 * declares the exact ordered steps to run. Because it is explicit rather than
 * inferred, it also makes verification work for projects Axle can't yet detect
 * (any language, custom pipelines), not just Node.
 */

export const VerifyConfigStepSchema = z.object({
  /** Short label, e.g. "install", "test", "e2e". */
  name: z.string().min(1),
  /** The exact shell command to run for this step. */
  command: z.string().min(1),
  /** Whether a failure fails the whole verification. Defaults to true. */
  required: z.boolean().default(true),
  /** Per-step wall-clock timeout in seconds. */
  timeoutSeconds: z.number().int().positive().default(600),
});
export type VerifyConfigStep = z.infer<typeof VerifyConfigStepSchema>;

export const VerifyConfigSchema = z.object({
  /** Optional schema version, for forward compatibility. */
  version: z.number().int().positive().optional(),
  /** Execution profile (environment) name, e.g. "node-22". */
  profile: z.string().default("node-22"),
  /** The ordered verification steps; at least one is required. */
  steps: z
    .array(VerifyConfigStepSchema)
    .min(1, "axle.yaml needs at least one step"),
});
export type VerifyConfig = z.infer<typeof VerifyConfigSchema>;

/** Conventional `axle.yaml` file names, in the order they are looked up. */
export const VERIFY_CONFIG_FILENAMES = ["axle.yaml", "axle.yml"] as const;
