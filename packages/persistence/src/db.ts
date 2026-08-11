import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "./schema";

/**
 * `node:sqlite` is an experimental builtin that is not listed in
 * `module.builtinModules`, which trips up bundlers (Vite/esbuild) that try to
 * resolve a static `import ... from "node:sqlite"`. We instead grab it at
 * runtime via `process.getBuiltinModule` (Node 22.3+), leaving no static import
 * for a bundler to see. The type still comes from `@types/node`.
 */
type SqliteModule = typeof import("node:sqlite");
const sqlite = process.getBuiltinModule("node:sqlite") as SqliteModule;

/**
 * Open (creating if necessary) the Axle SQLite database.
 *
 * WAL mode + a busy timeout let the API and worker processes share one database
 * file safely (concurrent readers, single writer).
 */
export function openDatabase(dbPath: string): DatabaseSync {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/**
 * Forward-only migrations for databases created by an earlier schema. `SCHEMA`
 * is `CREATE TABLE IF NOT EXISTS`, so columns added to an existing table land
 * here as idempotent `ADD COLUMN`s rather than in the create statement.
 */
function migrate(db: DatabaseSync): void {
  ensureColumn(db, "executions", "limits_json", "TEXT");
  ensureColumn(db, "executions", "environment", "TEXT");
}

/** Add `column` to `table` if it isn't already present. */
function ensureColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  type: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export type Database = DatabaseSync;
