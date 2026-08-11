import { z } from "zod";

/**
 * Environments & secrets — control-plane configuration.
 *
 * A named bundle of environment variables and secrets that executions resolve
 * at run time. It is the answer to "how does a verification get NODE_ENV, a
 * registry token, or a database URL?": you configure it once, behind the API,
 * and reference it by name from an execution.
 *
 * Secret *values* are write-only. They are set through the API and injected
 * into an execution by Axle at run time, but are never returned on read, never
 * copied into the execution record (only the environment's name is), and
 * redacted from captured logs. Non-secret `variables` are readable config.
 */

/** Environment names appear in URLs and CLI args — keep them simple. */
export const EnvironmentNameSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "environment name may only contain letters, numbers, '.', '_', '-'",
  );

export const EnvironmentSchema = z.object({
  name: EnvironmentNameSchema,
  /** Non-secret variables — safe to read back and display. */
  variables: z.record(z.string()).default({}),
  /** Names of the secrets held; values are never returned. */
  secretNames: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Environment = z.infer<typeof EnvironmentSchema>;

/**
 * Upsert payload: merges the given variables and secrets into the environment,
 * creating it if necessary. Existing keys not mentioned are left untouched.
 */
export const SetEnvironmentRequestSchema = z.object({
  variables: z.record(z.string()).default({}),
  /** key → secret value; write-only. */
  secrets: z.record(z.string()).default({}),
});
export type SetEnvironmentRequest = z.infer<typeof SetEnvironmentRequestSchema>;

export const EnvironmentListResponseSchema = z.object({
  environments: z.array(EnvironmentSchema),
});
export type EnvironmentListResponse = z.infer<
  typeof EnvironmentListResponseSchema
>;

/**
 * A fully-resolved environment, including secret VALUES, used to run an
 * execution. Produced server-side at execution time and deliberately not a Zod
 * wire schema: it must never be serialized onto the API or into persistence.
 */
export interface ResolvedEnvironment {
  variables: Record<string, string>;
  secrets: Record<string, string>;
}
