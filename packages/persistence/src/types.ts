import type {
  Artifact,
  Diagnostic,
  Environment,
  Execution,
  ExecutionEvent,
  ExecutionListResponse,
  ExecutionMetrics,
  ExecutionStatus,
  ExecutionStep,
  ListExecutionsQuery,
  ResolvedEnvironment,
  SetEnvironmentRequest,
  StoredEvent,
} from "@axle/contracts";

export interface UpdateExecutionPatch {
  startedAt?: string;
  completedAt?: string;
  metrics?: ExecutionMetrics;
}

/**
 * Persistence boundary for the execution history.
 *
 * The execution record is treated as strategically valuable structured data
 * (it will later power test-impact analysis, failure prediction, and planning),
 * so it is stored normalized — not as opaque blobs. The interface is async and
 * storage-agnostic so a Postgres implementation can replace SQLite later.
 */
export interface ExecutionStore {
  createExecution(execution: Execution): Promise<Execution>;
  getExecution(id: string): Promise<Execution | undefined>;
  listExecutions(query: ListExecutionsQuery): Promise<ExecutionListResponse>;
  updateExecutionStatus(
    id: string,
    status: ExecutionStatus,
    patch?: UpdateExecutionPatch,
  ): Promise<void>;
  updateStep(step: ExecutionStep): Promise<void>;
  addDiagnostics(executionId: string, diagnostics: Diagnostic[]): Promise<void>;
  addArtifact(artifact: Artifact): Promise<void>;
  /** Append an event; returns its monotonic sequence number. */
  appendEvent(event: ExecutionEvent): Promise<number>;
  listEventsSince(
    executionId: string,
    sinceSeq: number,
  ): Promise<StoredEvent[]>;
  requestCancel(id: string): Promise<boolean>;
  isCancelRequested(id: string): Promise<boolean>;
  /**
   * Atomically claim the oldest queued execution, transitioning it to
   * `provisioning`. Returns undefined when the queue is empty. This is the seam
   * a Redis/SQS-backed queue would later replace.
   */
  claimNextQueued(): Promise<Execution | undefined>;
  close(): void;
}

/**
 * Persistence boundary for control-plane environments & secrets.
 *
 * Secret values live here and are exposed two ways with very different trust:
 * `getEnvironment`/`listEnvironments` return only secret *names* (the safe read
 * path used by the API), while `resolveEnvironment` returns secret *values* and
 * is called only by the worker at execution time — never surfaced over the API.
 */
export interface EnvironmentStore {
  /** Upsert variables/secrets into `name`, creating it if needed. */
  setEnvironment(
    name: string,
    values: SetEnvironmentRequest,
  ): Promise<Environment>;
  /** Read an environment with secret names but NOT secret values. */
  getEnvironment(name: string): Promise<Environment | undefined>;
  listEnvironments(): Promise<Environment[]>;
  deleteEnvironment(name: string): Promise<boolean>;
  /** Resolve variables + secret VALUES for execution. Never exposed via the API. */
  resolveEnvironment(name: string): Promise<ResolvedEnvironment | undefined>;
  close(): void;
}
