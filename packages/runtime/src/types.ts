import type { ExecutionProfile, ResourceLimits } from "@axle/contracts";

/**
 * A request to provision an execution environment. This is the only thing the
 * application layer hands a runtime provider — it carries no provider-specific
 * concepts (no image ids, container flags, etc.).
 */
export interface RuntimeRequest {
  executionId: string;
  profile: ExecutionProfile;
  limits: ResourceLimits;
  /** Environment variables to expose inside the environment (allowlisted). */
  env?: Record<string, string>;
}

export interface OutputChunk {
  stream: "stdout" | "stderr";
  data: string;
}

/**
 * A command to run inside an execution environment.
 */
export interface CommandRequest {
  command: string;
  /** Working directory relative to the workspace root; defaults to the root. */
  cwd?: string;
  env?: Record<string, string>;
  timeoutSeconds: number;
  /** Cap on captured output before it is truncated. */
  maxOutputBytes: number;
  /** Called for each chunk of streamed output. */
  onOutput?: (chunk: OutputChunk) => void;
}

export interface CommandResult {
  /** Process exit code, or null if the process was killed / never exited. */
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  outputBytes: number;
  truncated: boolean;
}
