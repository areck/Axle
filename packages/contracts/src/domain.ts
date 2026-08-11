import { z } from "zod";

/**
 * The Axle domain model.
 *
 * The central abstraction is the {@link Execution}: an agent's request to
 * perform engineering work inside a trusted environment and receive structured
 * evidence about the result — `execute(change, intent, environment) -> evidence`.
 *
 * These schemas are the shared contract between the CLI, API, worker, and every
 * runtime provider. Nothing runtime-specific (Docker, subprocess, …) belongs here.
 */

// --- Repository ------------------------------------------------------------

export const RepositoryRefSchema = z.object({
  name: z.string(),
  remoteUrl: z.string().optional(),
  defaultBranch: z.string().optional(),
});
export type RepositoryRef = z.infer<typeof RepositoryRefSchema>;

// --- Change snapshot -------------------------------------------------------

export const ChangeTypeSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
]);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const ChangedFileSchema = z.object({
  path: z.string(),
  changeType: ChangeTypeSchema,
  oldPath: z.string().optional(),
});
export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const SnapshotFileSchema = z.object({
  path: z.string(),
  /** Base64-encoded contents — binary-safe and JSON-transportable. */
  contentBase64: z.string(),
  /** POSIX file mode, when known. */
  mode: z.number().int().optional(),
  sizeBytes: z.number().int().nonnegative(),
});
export type SnapshotFile = z.infer<typeof SnapshotFileSchema>;

/**
 * A self-contained snapshot of the working-tree state an agent wants verified.
 *
 * `files` are the materialized project files to write into a clean workspace —
 * the whole transport. There is deliberately no patch to apply and no base tree
 * to reconstruct: the snapshot already *is* the desired state, which keeps
 * workspace preparation trivial and binary-safe across every runtime. `baseSha`
 * and `changedFiles` are provenance metadata (display + the execution graph).
 *
 * The shape leaves room for future transports (a patch against a base cloned
 * from a remote, a git branch, a PR) behind the same `prepareWorkspace` seam,
 * to be added only when a real need — e.g. very large repositories — appears.
 */
export const ChangeSnapshotSchema = z.object({
  baseSha: z.string(),
  /** Which files changed vs `baseSha` — metadata for display and the graph. */
  changedFiles: z.array(ChangedFileSchema).default([]),
  /** The materialized project files to write into the clean workspace. */
  files: z.array(SnapshotFileSchema).default([]),
});
export type ChangeSnapshot = z.infer<typeof ChangeSnapshotSchema>;

/** An empty change snapshot — used by `axle run`, which ships no workspace. */
export function emptyChangeSnapshot(baseSha = "0000000"): ChangeSnapshot {
  return { baseSha, changedFiles: [], files: [] };
}

// --- Execution profile -----------------------------------------------------

export const ExecutionProfileSchema = z.object({
  /** Logical profile name, e.g. "node-22". */
  name: z.string(),
  /** Optional concrete image/runtime hint for the provider. */
  image: z.string().optional(),
  cpu: z.number().positive().optional(),
  memoryMb: z.number().int().positive().optional(),
  env: z.record(z.string()).optional(),
});
export type ExecutionProfile = z.infer<typeof ExecutionProfileSchema>;

export const DEFAULT_PROFILE: ExecutionProfile = { name: "node-22" };

// --- Execution plan --------------------------------------------------------

export const PlannedStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  timeoutSeconds: z.number().int().positive().default(600),
  required: z.boolean().default(true),
});
export type PlannedStep = z.infer<typeof PlannedStepSchema>;

/**
 * What Axle determined should run. Produced by the planner (deferred to a later
 * pass) or supplied directly (e.g. `axle run "<command>"`).
 */
export const ExecutionPlanSchema = z.object({
  profile: z.string(),
  steps: z.array(PlannedStepSchema),
  reason: z.string().optional(),
});
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

// --- Execution step (observation) ------------------------------------------

export const ExecutionStepStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "timedOut",
  "skipped",
]);
export type ExecutionStepStatus = z.infer<typeof ExecutionStepStatusSchema>;

export const ExecutionStepSchema = z.object({
  id: z.string(),
  plannedStepId: z.string(),
  name: z.string(),
  command: z.string(),
  status: ExecutionStepStatusSchema,
  exitCode: z.number().int().nullable().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  outputBytes: z.number().int().nonnegative().optional(),
  truncated: z.boolean().optional(),
});
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;

// --- Diagnostics -----------------------------------------------------------

export const DiagnosticTypeSchema = z.enum([
  "build",
  "test",
  "lint",
  "runtime",
  "infrastructure",
  "unknown",
]);
export type DiagnosticType = z.infer<typeof DiagnosticTypeSchema>;

export const DiagnosticSeveritySchema = z.enum(["info", "warning", "error"]);
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeveritySchema>;

/**
 * A structured explanation of an execution problem. Designed to become
 * increasingly structured over time (test impact, ownership, fixes, …).
 */
export const DiagnosticSchema = z.object({
  id: z.string().optional(),
  type: DiagnosticTypeSchema,
  severity: DiagnosticSeveritySchema,
  message: z.string(),
  file: z.string().optional(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
  stepId: z.string().optional(),
  /** A short raw excerpt the diagnostic was derived from, for traceability. */
  rawReference: z.string().optional(),
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;

// --- Artifacts (evidence) --------------------------------------------------

export const ArtifactSchema = z.object({
  id: z.string(),
  executionId: z.string(),
  /** Logical kind, e.g. "log", "report", "build-output". */
  type: z.string(),
  name: z.string(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  /** Opaque key understood by the artifact store. */
  storageKey: z.string(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

// --- Metrics ---------------------------------------------------------------

export const ExecutionMetricsSchema = z.object({
  queueWaitMs: z.number().int().nonnegative().optional(),
  totalDurationMs: z.number().int().nonnegative().optional(),
  stepCount: z.number().int().nonnegative().default(0),
  failedStepCount: z.number().int().nonnegative().default(0),
});
export type ExecutionMetrics = z.infer<typeof ExecutionMetricsSchema>;

export function emptyMetrics(): ExecutionMetrics {
  return { stepCount: 0, failedStepCount: 0 };
}

// --- Resource limits (Axle Control) ----------------------------------------

/**
 * The effective limits the runtime must enforce for an execution. Produced by
 * an {@link ExecutionPolicy} and carried on the Execution so the worker enforces
 * exactly what was decided at admission time.
 */
export const ResourceLimitsSchema = z.object({
  cpu: z.number().positive(),
  memoryMb: z.number().int().positive(),
  /** Wall-clock budget for the whole execution. */
  totalTimeoutSeconds: z.number().int().positive(),
  /** Maximum captured output per step before truncation. */
  maxOutputBytes: z.number().int().positive(),
});
export type ResourceLimits = z.infer<typeof ResourceLimitsSchema>;

export const DEFAULT_LIMITS: ResourceLimits = {
  cpu: 2,
  memoryMb: 4096,
  totalTimeoutSeconds: 1800,
  maxOutputBytes: 5_000_000,
};

// --- Execution -------------------------------------------------------------

export const ExecutionStatusSchema = z.enum([
  "queued",
  "provisioning",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const TERMINAL_STATUSES: readonly ExecutionStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
];

export function isTerminalStatus(status: ExecutionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export const ExecutionSchema = z.object({
  id: z.string(),
  repository: RepositoryRefSchema,
  change: ChangeSnapshotSchema,
  intent: z.string().optional(),
  profile: ExecutionProfileSchema,
  plan: ExecutionPlanSchema,
  status: ExecutionStatusSchema,
  /** Name of the control-plane environment to resolve vars/secrets from. */
  environment: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  steps: z.array(ExecutionStepSchema).default([]),
  diagnostics: z.array(DiagnosticSchema).default([]),
  artifacts: z.array(ArtifactSchema).default([]),
  metrics: ExecutionMetricsSchema,
  limits: ResourceLimitsSchema.default(DEFAULT_LIMITS),
});
export type Execution = z.infer<typeof ExecutionSchema>;
