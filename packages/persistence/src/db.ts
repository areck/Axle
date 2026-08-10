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
  return db;
}

export type Database = DatabaseSync;
