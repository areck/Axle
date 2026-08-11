import {
  type Artifact,
  DEFAULT_LIMITS,
  type Diagnostic,
  type Execution,
  type ExecutionEvent,
  type ExecutionListResponse,
  type ExecutionStatus,
  type ExecutionStep,
  type ExecutionSummary,
  type ListExecutionsQuery,
  type StoredEvent,
} from "@axle/contracts";
import { and, asc, count, desc, eq, gt, inArray } from "drizzle-orm";
import { type AxleDatabase, closeDatabase, openDatabase } from "../db";
import {
  artifacts as artifactsTable,
  diagnostics as diagnosticsTable,
  executionEvents,
  executionSteps,
  executions,
} from "../schema";
import type { ExecutionStore, UpdateExecutionPatch } from "../types";

const ACTIVE_STATUSES: ExecutionStatus[] = [
  "queued",
  "provisioning",
  "running",
];

/** Rows selected from the tables, typed by the Drizzle schema. */
type ExecutionRow = typeof executions.$inferSelect;
type StepRow = typeof executionSteps.$inferSelect;
type DiagnosticRow = typeof diagnosticsTable.$inferSelect;
type ArtifactRow = typeof artifactsTable.$inferSelect;

/**
 * SQLite-backed execution history, on Drizzle + better-sqlite3. Structured
 * columns for what we query and JSON text for nested value objects.
 */
export class SqliteExecutionStore implements ExecutionStore {
  private readonly db: AxleDatabase;

  constructor(dbPath: string) {
    this.db = openDatabase(dbPath);
  }

  async createExecution(execution: Execution): Promise<Execution> {
    this.db
      .insert(executions)
      .values({
        id: execution.id,
        status: execution.status,
        intent: execution.intent ?? null,
        repositoryJson: JSON.stringify(execution.repository),
        changeJson: JSON.stringify(execution.change),
        profileJson: JSON.stringify(execution.profile),
        planJson: JSON.stringify(execution.plan),
        metricsJson: JSON.stringify(execution.metrics),
        limitsJson: JSON.stringify(execution.limits),
        environment: execution.environment ?? null,
        createdAt: execution.createdAt,
        startedAt: execution.startedAt ?? null,
        completedAt: execution.completedAt ?? null,
      })
      .run();

    if (execution.steps.length > 0) {
      this.db
        .insert(executionSteps)
        .values(
          execution.steps.map((step, ordinal) => ({
            id: step.id,
            executionId: execution.id,
            plannedStepId: step.plannedStepId,
            ordinal,
            name: step.name,
            command: step.command,
            status: step.status,
            exitCode: step.exitCode ?? null,
            startedAt: step.startedAt ?? null,
            completedAt: step.completedAt ?? null,
            durationMs: step.durationMs ?? null,
            outputBytes: step.outputBytes ?? null,
            truncated: step.truncated ?? null,
          })),
        )
        .run();
    }

    return execution;
  }

  async getExecution(id: string): Promise<Execution | undefined> {
    const row = this.db
      .select()
      .from(executions)
      .where(eq(executions.id, id))
      .get();
    return row ? this.hydrate(row) : undefined;
  }

  async listExecutions(
    query: ListExecutionsQuery,
  ): Promise<ExecutionListResponse> {
    const filter = query.status
      ? eq(executions.status, query.status)
      : undefined;

    const total = this.db
      .select({ value: count() })
      .from(executions)
      .where(filter)
      .get();

    const rows = this.db
      .select()
      .from(executions)
      .where(filter)
      .orderBy(desc(executions.createdAt))
      .limit(query.limit)
      .offset(query.offset)
      .all();

    const ids = rows.map((r) => r.id);
    const stepCounts = ids.length
      ? this.db
          .select({
            executionId: executionSteps.executionId,
            value: count(),
          })
          .from(executionSteps)
          .where(inArray(executionSteps.executionId, ids))
          .groupBy(executionSteps.executionId)
          .all()
      : [];
    const countByExecution = new Map(
      stepCounts.map((c) => [c.executionId, Number(c.value)]),
    );

    return {
      total: Number(total?.value ?? 0),
      executions: rows.map((row) =>
        this.toSummary(row, countByExecution.get(row.id) ?? 0),
      ),
    };
  }

  async updateExecutionStatus(
    id: string,
    status: ExecutionStatus,
    patch: UpdateExecutionPatch = {},
  ): Promise<void> {
    // Only overwrite the columns actually provided (COALESCE semantics).
    const set: Partial<typeof executions.$inferInsert> = { status };
    if (patch.startedAt !== undefined) set.startedAt = patch.startedAt;
    if (patch.completedAt !== undefined) set.completedAt = patch.completedAt;
    if (patch.metrics !== undefined) {
      set.metricsJson = JSON.stringify(patch.metrics);
    }
    this.db.update(executions).set(set).where(eq(executions.id, id)).run();
  }

  async updateStep(step: ExecutionStep): Promise<void> {
    this.db
      .update(executionSteps)
      .set({
        status: step.status,
        exitCode: step.exitCode ?? null,
        startedAt: step.startedAt ?? null,
        completedAt: step.completedAt ?? null,
        durationMs: step.durationMs ?? null,
        outputBytes: step.outputBytes ?? null,
        truncated: step.truncated ?? null,
      })
      .where(eq(executionSteps.id, step.id))
      .run();
  }

  async addDiagnostics(
    executionId: string,
    items: Diagnostic[],
  ): Promise<void> {
    if (items.length === 0) return;
    this.db
      .insert(diagnosticsTable)
      .values(
        items.map((d) => ({
          id: d.id ?? `diag_${executionId}_${randomSuffix()}`,
          executionId,
          stepId: d.stepId ?? null,
          type: d.type,
          severity: d.severity,
          message: d.message,
          file: d.file ?? null,
          line: d.line ?? null,
          columnNo: d.column ?? null,
          rawReference: d.rawReference ?? null,
        })),
      )
      .run();
  }

  async addArtifact(artifact: Artifact): Promise<void> {
    this.db
      .insert(artifactsTable)
      .values({
        id: artifact.id,
        executionId: artifact.executionId,
        type: artifact.type,
        name: artifact.name,
        mimeType: artifact.mimeType ?? null,
        sizeBytes: artifact.sizeBytes ?? null,
        storageKey: artifact.storageKey,
      })
      .run();
  }

  async appendEvent(event: ExecutionEvent): Promise<number> {
    const inserted = this.db
      .insert(executionEvents)
      .values({
        executionId: event.executionId,
        type: event.type,
        payloadJson: JSON.stringify(event),
        createdAt: event.at,
      })
      .returning({ seq: executionEvents.seq })
      .get();
    return Number(inserted?.seq ?? 0);
  }

  async listEventsSince(
    executionId: string,
    sinceSeq: number,
  ): Promise<StoredEvent[]> {
    const rows = this.db
      .select({
        seq: executionEvents.seq,
        executionId: executionEvents.executionId,
        payloadJson: executionEvents.payloadJson,
      })
      .from(executionEvents)
      .where(
        and(
          eq(executionEvents.executionId, executionId),
          gt(executionEvents.seq, sinceSeq),
        ),
      )
      .orderBy(asc(executionEvents.seq))
      .all();
    return rows.map((row) => ({
      seq: Number(row.seq),
      executionId: row.executionId,
      event: JSON.parse(row.payloadJson) as ExecutionEvent,
    }));
  }

  async requestCancel(id: string): Promise<boolean> {
    const result = this.db
      .update(executions)
      .set({ cancelRequested: true })
      .where(
        and(eq(executions.id, id), inArray(executions.status, ACTIVE_STATUSES)),
      )
      .run();
    return result.changes > 0;
  }

  async isCancelRequested(id: string): Promise<boolean> {
    const row = this.db
      .select({ cancelRequested: executions.cancelRequested })
      .from(executions)
      .where(eq(executions.id, id))
      .get();
    return row?.cancelRequested === true;
  }

  async claimNextQueued(): Promise<Execution | undefined> {
    const row = this.db
      .select({ id: executions.id })
      .from(executions)
      .where(eq(executions.status, "queued"))
      .orderBy(asc(executions.createdAt), asc(executions.id))
      .limit(1)
      .get();
    if (!row) return undefined;

    const startedAt = new Date().toISOString();
    const result = this.db
      .update(executions)
      .set({ status: "provisioning", startedAt })
      .where(and(eq(executions.id, row.id), eq(executions.status, "queued")))
      .run();
    if (result.changes === 0) return undefined; // lost the race to another worker

    return this.getExecution(row.id);
  }

  close(): void {
    closeDatabase(this.db);
  }

  // --- hydration ---------------------------------------------------------

  private hydrate(row: ExecutionRow): Execution {
    const steps = this.db
      .select()
      .from(executionSteps)
      .where(eq(executionSteps.executionId, row.id))
      .orderBy(asc(executionSteps.ordinal))
      .all()
      .map(rowToStep);

    const diags = this.db
      .select()
      .from(diagnosticsTable)
      .where(eq(diagnosticsTable.executionId, row.id))
      .all()
      .map(rowToDiagnostic);

    const arts = this.db
      .select()
      .from(artifactsTable)
      .where(eq(artifactsTable.executionId, row.id))
      .all()
      .map(rowToArtifact);

    return {
      id: row.id,
      repository: JSON.parse(row.repositoryJson),
      change: JSON.parse(row.changeJson),
      intent: row.intent ?? undefined,
      profile: JSON.parse(row.profileJson),
      plan: JSON.parse(row.planJson),
      status: row.status as ExecutionStatus,
      environment: row.environment ?? undefined,
      createdAt: row.createdAt,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
      steps,
      diagnostics: diags,
      artifacts: arts,
      metrics: JSON.parse(row.metricsJson),
      limits: row.limitsJson ? JSON.parse(row.limitsJson) : DEFAULT_LIMITS,
    };
  }

  private toSummary(row: ExecutionRow, stepCount: number): ExecutionSummary {
    const durationMs =
      row.startedAt && row.completedAt
        ? Date.parse(row.completedAt) - Date.parse(row.startedAt)
        : undefined;
    return {
      id: row.id,
      status: row.status as ExecutionStatus,
      intent: row.intent ?? undefined,
      repositoryName: JSON.parse(row.repositoryJson).name,
      profileName: JSON.parse(row.profileJson).name,
      stepCount,
      createdAt: row.createdAt,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
      durationMs,
    };
  }
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2);
}

function rowToStep(row: StepRow): ExecutionStep {
  return {
    id: row.id,
    plannedStepId: row.plannedStepId,
    name: row.name,
    command: row.command,
    status: row.status as ExecutionStep["status"],
    exitCode: row.exitCode ?? undefined,
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    durationMs: row.durationMs ?? undefined,
    outputBytes: row.outputBytes ?? undefined,
    truncated: row.truncated ?? undefined,
  };
}

function rowToDiagnostic(row: DiagnosticRow): Diagnostic {
  return {
    id: row.id,
    type: row.type as Diagnostic["type"],
    severity: row.severity as Diagnostic["severity"],
    message: row.message,
    file: row.file ?? undefined,
    line: row.line ?? undefined,
    column: row.columnNo ?? undefined,
    stepId: row.stepId ?? undefined,
    rawReference: row.rawReference ?? undefined,
  };
}

function rowToArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    executionId: row.executionId,
    type: row.type,
    name: row.name,
    mimeType: row.mimeType ?? undefined,
    sizeBytes: row.sizeBytes ?? undefined,
    storageKey: row.storageKey,
  };
}
