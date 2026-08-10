import type { Readable } from "node:stream";
import type { ArtifactStore } from "@axle/artifacts";
import {
  type Artifact,
  type CreateExecutionRequest,
  DEFAULT_PROFILE,
  type Execution,
  type ExecutionListResponse,
  type ExecutionPolicy,
  type ExecutionStep,
  type ListExecutionsQuery,
  type StoredEvent,
  emptyChangeSnapshot,
  emptyMetrics,
  newExecutionId,
  newStepId,
} from "@axle/contracts";
import type { ExecutionStore } from "@axle/persistence";

export type CreateExecutionResult =
  | { ok: true; execution: Execution }
  | { ok: false; reasons: string[] };

export interface OpenedArtifact {
  artifact: Artifact;
  stream: Readable;
}

/**
 * The API's implementation layer: everything about executions that is *not* an
 * HTTP concern. Route handlers stay thin (validation, status codes, streaming)
 * and delegate the work here.
 */
export class ExecutionService {
  constructor(
    private readonly store: ExecutionStore,
    private readonly artifacts: ArtifactStore,
    private readonly policy: ExecutionPolicy,
  ) {}

  async create(
    request: CreateExecutionRequest,
  ): Promise<CreateExecutionResult> {
    const decision = await this.policy.validate(request);
    if (!decision.allow) {
      return { ok: false, reasons: decision.reasons ?? ["rejected by policy"] };
    }
    const execution = buildExecution(request);
    await this.store.createExecution(execution);
    await this.store.appendEvent({
      type: "execution.status",
      executionId: execution.id,
      status: "queued",
      at: execution.createdAt,
    });
    return { ok: true, execution };
  }

  list(query: ListExecutionsQuery): Promise<ExecutionListResponse> {
    return this.store.listExecutions(query);
  }

  get(id: string): Promise<Execution | undefined> {
    return this.store.getExecution(id);
  }

  cancel(id: string): Promise<boolean> {
    return this.store.requestCancel(id);
  }

  eventsSince(id: string, sinceSeq: number): Promise<StoredEvent[]> {
    return this.store.listEventsSince(id, sinceSeq);
  }

  async openArtifact(
    execution: Execution,
    artifactId: string,
  ): Promise<OpenedArtifact | undefined> {
    const artifact = execution.artifacts.find((a) => a.id === artifactId);
    if (!artifact) return undefined;
    if (!(await this.artifacts.exists(artifact.storageKey))) return undefined;
    return {
      artifact,
      stream: this.artifacts.createReadStream(artifact.storageKey),
    };
  }
}

function buildExecution(request: CreateExecutionRequest): Execution {
  const createdAt = new Date().toISOString();
  const steps: ExecutionStep[] = request.plan.steps.map((planned) => ({
    id: newStepId(),
    plannedStepId: planned.id,
    name: planned.name,
    command: planned.command,
    status: "pending",
  }));
  return {
    id: newExecutionId(),
    repository: request.repository,
    change: request.change ?? emptyChangeSnapshot(),
    intent: request.intent,
    profile: request.profile ?? DEFAULT_PROFILE,
    plan: request.plan,
    status: "queued",
    createdAt,
    steps,
    diagnostics: [],
    artifacts: [],
    metrics: emptyMetrics(),
  };
}
