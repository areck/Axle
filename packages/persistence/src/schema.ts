import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Drizzle schema for the Axle execution history and control-plane config.
 *
 * Structured, queryable columns (status, timestamps, names) plus JSON text for
 * nested value objects (repository, change, plan, metrics, limits). This is the
 * single source of truth: `drizzle-kit generate` derives the SQL migrations
 * under `drizzle/` from these definitions.
 */

export const executions = sqliteTable(
  "executions",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull(),
    intent: text("intent"),
    repositoryJson: text("repository_json").notNull(),
    changeJson: text("change_json").notNull(),
    profileJson: text("profile_json").notNull(),
    planJson: text("plan_json").notNull(),
    metricsJson: text("metrics_json").notNull(),
    limitsJson: text("limits_json"),
    environment: text("environment"),
    cancelRequested: integer("cancel_requested", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (t) => [
    index("idx_executions_status").on(t.status),
    index("idx_executions_created").on(t.createdAt),
  ],
);

export const executionSteps = sqliteTable(
  "execution_steps",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id),
    plannedStepId: text("planned_step_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    name: text("name").notNull(),
    command: text("command").notNull(),
    status: text("status").notNull(),
    exitCode: integer("exit_code"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    durationMs: integer("duration_ms"),
    outputBytes: integer("output_bytes"),
    truncated: integer("truncated", { mode: "boolean" }),
  },
  (t) => [index("idx_steps_execution").on(t.executionId, t.ordinal)],
);

export const diagnostics = sqliteTable(
  "diagnostics",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id),
    stepId: text("step_id"),
    type: text("type").notNull(),
    severity: text("severity").notNull(),
    message: text("message").notNull(),
    file: text("file"),
    line: integer("line"),
    columnNo: integer("column_no"),
    rawReference: text("raw_reference"),
  },
  (t) => [index("idx_diag_execution").on(t.executionId)],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id),
    type: text("type").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    storageKey: text("storage_key").notNull(),
  },
  (t) => [index("idx_artifacts_execution").on(t.executionId)],
);

export const executionEvents = sqliteTable(
  "execution_events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    executionId: text("execution_id").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_events_execution").on(t.executionId, t.seq)],
);

export const environments = sqliteTable("environments", {
  name: text("name").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const environmentVars = sqliteTable(
  "environment_vars",
  {
    environmentName: text("environment_name")
      .notNull()
      .references(() => environments.name, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    isSecret: integer("is_secret", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (t) => [primaryKey({ columns: [t.environmentName, t.key] })],
);
