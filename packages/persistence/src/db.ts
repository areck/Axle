import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type AxleDatabase = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Generated migrations live at the package root (`drizzle/`), a sibling of both
 * `src/` (tsx/vitest) and `dist/` (tsup), so this resolves in every run mode.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * Open (creating if necessary) the Axle database on better-sqlite3 + Drizzle.
 *
 * WAL mode + a busy timeout let the API and worker processes share one file
 * (concurrent readers, single writer); foreign keys are enforced. The schema is
 * brought up to date from the generated migrations.
 */
export function openDatabase(dbPath: string): AxleDatabase {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

export function closeDatabase(db: AxleDatabase): void {
  db.$client.close();
}
