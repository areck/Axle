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
import { type Database, openDatabase } from "./db";
import type { ExecutionStore, UpdateExecutionPatch } from "./types";

/** null-coalesce an optional value into a SQLite-bindable (never undefined). */
function orNull<T>(value: T | undefined | null): T | null {
  return value ?? null;
}

function boolToInt(value: boolean | undefined): number | null {
  if (value === undefined) return null;
  return value ? 1 : 0;
}

/**
 * SQLite-backed execution history.
 */
export class SqliteExecutionStore implements ExecutionStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    this.db = openDatabase(dbPath);
  }

  async createExecution(execution: Execution): Promise<Execution> {
    const insertExecution = this.db.prepare(
      `INSERT INTO executions
        (id, status, intent, repository_json, change_json, profile_json,
         plan_json, metrics_json, limits_json, cancel_requested, created_at,
         started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    );
    insertExecution.run(
      execution.id,
      execution.status,
      orNull(execution.intent),
      JSON.stringify(execution.repository),
      JSON.stringify(execution.change),
      JSON.stringify(execution.profile),
      JSON.stringify(execution.plan),
      JSON.stringify(execution.metrics),
      JSON.stringify(execution.limits),
      execution.createdAt,
      orNull(execution.startedAt),
      orNull(execution.completedAt),
    );

    const insertStep = this.db.prepare(
      `INSERT INTO execution_steps
        (id, execution_id, planned_step_id, ordinal, name, command, status,
         exit_code, started_at, completed_at, duration_ms, output_bytes, truncated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    execution.steps.forEach((step, ordinal) => {
      insertStep.run(
        step.id,
        execution.id,
        step.plannedStepId,
        ordinal,
        step.name,
        step.command,
        step.status,
        orNull(step.exitCode),
        orNull(step.startedAt),
        orNull(step.completedAt),
        orNull(step.durationMs),
        orNull(step.outputBytes),
        boolToInt(step.truncated),
      );
    });

    return execution;
  }

  async getExecution(id: string): Promise<Execution | undefined> {
    const row: any = this.db
      .prepare(`SELECT * FROM executions WHERE id = ?`)
      .get(id);
    if (!row) return undefined;
    return this.hydrate(row);
  }

  async listExecutions(
    query: ListExecutionsQuery,
  ): Promise<ExecutionListResponse> {
    const where = query.status ? `WHERE status = ?` : "";
    const countRow: any = query.status
      ? this.db
          .prepare(`SELECT COUNT(*) AS c FROM executions ${where}`)
          .get(query.status)
      : this.db.prepare(`SELECT COUNT(*) AS c FROM executions`).get();

    const listStmt = this.db.prepare(
      `SELECT e.*,
        (SELECT COUNT(*) FROM execution_steps s WHERE s.execution_id = e.id) AS step_count
       FROM executions e
       ${where}
       ORDER BY e.created_at DESC
       LIMIT ? OFFSET ?`,
    );
    const rows: any[] = query.status
      ? listStmt.all(query.status, query.limit, query.offset)
      : listStmt.all(query.limit, query.offset);

    return {
      total: Number(countRow?.c ?? 0),
      executions: rows.map((row) => this.toSummary(row)),
    };
  }

  async updateExecutionStatus(
    id: string,
    status: ExecutionStatus,
    patch: UpdateExecutionPatch = {},
  ): Promise<void> {
    this.db
      .prepare(
        `UPDATE executions
         SET status = ?,
             started_at = COALESCE(?, started_at),
             completed_at = COALESCE(?, completed_at),
             metrics_json = COALESCE(?, metrics_json)
         WHERE id = ?`,
      )
      .run(
        status,
        orNull(patch.startedAt),
        orNull(patch.completedAt),
        patch.metrics ? JSON.stringify(patch.metrics) : null,
        id,
      );
  }

  async updateStep(step: ExecutionStep): Promise<void> {
    this.db
      .prepare(
        `UPDATE execution_steps
         SET status = ?, exit_code = ?, started_at = ?, completed_at = ?,
             duration_ms = ?, output_bytes = ?, truncated = ?
         WHERE id = ?`,
      )
      .run(
        step.status,
        orNull(step.exitCode),
        orNull(step.startedAt),
        orNull(step.completedAt),
        orNull(step.durationMs),
        orNull(step.outputBytes),
        boolToInt(step.truncated),
        step.id,
      );
  }

  async addDiagnostics(
    executionId: string,
    diagnostics: Diagnostic[],
  ): Promise<void> {
    const insert = this.db.prepare(
      `INSERT INTO diagnostics
        (id, execution_id, step_id, type, severity, message, file, line, column_no, raw_reference)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const d of diagnostics) {
      insert.run(
        d.id ?? `diag_${executionId}_${Math.random().toString(36).slice(2)}`,
        executionId,
        orNull(d.stepId),
        d.type,
        d.severity,
        d.message,
        orNull(d.file),
        orNull(d.line),
        orNull(d.column),
        orNull(d.rawReference),
      );
    }
  }

  async addArtifact(artifact: Artifact): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO artifacts
          (id, execution_id, type, name, mime_type, size_bytes, storage_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.id,
        artifact.executionId,
        artifact.type,
        artifact.name,
        orNull(artifact.mimeType),
        orNull(artifact.sizeBytes),
        artifact.storageKey,
      );
  }

  async appendEvent(event: ExecutionEvent): Promise<number> {
    const result = this.db
      .prepare(
        `INSERT INTO execution_events (execution_id, type, payload_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(event.executionId, event.type, JSON.stringify(event), event.at);
    return Number(result.lastInsertRowid);
  }

  async listEventsSince(
    executionId: string,
    sinceSeq: number,
  ): Promise<StoredEvent[]> {
    const rows: any[] = this.db
      .prepare(
        `SELECT seq, execution_id, payload_json FROM execution_events
         WHERE execution_id = ? AND seq > ? ORDER BY seq ASC`,
      )
      .all(executionId, sinceSeq);
    return rows.map((row) => ({
      seq: Number(row.seq),
      executionId: row.execution_id,
      event: JSON.parse(row.payload_json) as ExecutionEvent,
    }));
  }

  async requestCancel(id: string): Promise<boolean> {
    const result = this.db
      .prepare(
        `UPDATE executions SET cancel_requested = 1
         WHERE id = ? AND status IN ('queued', 'provisioning', 'running')`,
      )
      .run(id);
    return result.changes > 0;
  }

  async isCancelRequested(id: string): Promise<boolean> {
    const row: any = this.db
      .prepare(`SELECT cancel_requested FROM executions WHERE id = ?`)
      .get(id);
    return row?.cancel_requested === 1;
  }

  async claimNextQueued(): Promise<Execution | undefined> {
    const row: any = this.db
      .prepare(
        `SELECT id FROM executions WHERE status = 'queued'
         ORDER BY created_at ASC, id ASC LIMIT 1`,
      )
      .get();
    if (!row) return undefined;

    const startedAt = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE executions SET status = 'provisioning', started_at = ?
         WHERE id = ? AND status = 'queued'`,
      )
      .run(startedAt, row.id);
    if (result.changes === 0) return undefined; // lost the race to another worker

    return this.getExecution(row.id);
  }

  close(): void {
    this.db.close();
  }

  // --- hydration ---------------------------------------------------------

  private hydrate(row: any): Execution {
    const steps: ExecutionStep[] = (
      this.db
        .prepare(
          `SELECT * FROM execution_steps WHERE execution_id = ? ORDER BY ordinal ASC`,
        )
        .all(row.id) as any[]
    ).map(rowToStep);

    const diagnostics: Diagnostic[] = (
      this.db
        .prepare(
          `SELECT * FROM diagnostics WHERE execution_id = ? ORDER BY rowid ASC`,
        )
        .all(row.id) as any[]
    ).map(rowToDiagnostic);

    const artifacts: Artifact[] = (
      this.db
        .prepare(
          `SELECT * FROM artifacts WHERE execution_id = ? ORDER BY rowid ASC`,
        )
        .all(row.id) as any[]
    ).map(rowToArtifact);

    return {
      id: row.id,
      repository: JSON.parse(row.repository_json),
      change: JSON.parse(row.change_json),
      intent: row.intent ?? undefined,
      profile: JSON.parse(row.profile_json),
      plan: JSON.parse(row.plan_json),
      status: row.status,
      createdAt: row.created_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      steps,
      diagnostics,
      artifacts,
      metrics: JSON.parse(row.metrics_json),
      limits: row.limits_json ? JSON.parse(row.limits_json) : DEFAULT_LIMITS,
    };
  }

  private toSummary(row: any): ExecutionSummary {
    const durationMs =
      row.started_at && row.completed_at
        ? Date.parse(row.completed_at) - Date.parse(row.started_at)
        : undefined;
    return {
      id: row.id,
      status: row.status,
      intent: row.intent ?? undefined,
      repositoryName: JSON.parse(row.repository_json).name,
      profileName: JSON.parse(row.profile_json).name,
      stepCount: Number(row.step_count ?? 0),
      createdAt: row.created_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      durationMs,
    };
  }
}

function rowToStep(row: any): ExecutionStep {
  return {
    id: row.id,
    plannedStepId: row.planned_step_id,
    name: row.name,
    command: row.command,
    status: row.status,
    exitCode: row.exit_code ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    outputBytes: row.output_bytes ?? undefined,
    truncated: row.truncated === null ? undefined : row.truncated === 1,
  };
}

function rowToDiagnostic(row: any): Diagnostic {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    message: row.message,
    file: row.file ?? undefined,
    line: row.line ?? undefined,
    column: row.column_no ?? undefined,
    stepId: row.step_id ?? undefined,
    rawReference: row.raw_reference ?? undefined,
  };
}

function rowToArtifact(row: any): Artifact {
  return {
    id: row.id,
    executionId: row.execution_id,
    type: row.type,
    name: row.name,
    mimeType: row.mime_type ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    storageKey: row.storage_key,
  };
}
