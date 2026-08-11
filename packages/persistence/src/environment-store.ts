import type {
  Environment,
  ResolvedEnvironment,
  SetEnvironmentRequest,
} from "@axle/contracts";
import { type Database, openDatabase } from "./db";
import type { Encryptor } from "./secret-crypto";
import type { EnvironmentStore } from "./types";

/**
 * SQLite-backed environments & secrets.
 *
 * Secret values are stored in the same normalized table as variables,
 * distinguished by an `is_secret` flag. The read methods
 * ({@link getEnvironment}, {@link listEnvironments}) project secrets down to
 * their names; only {@link resolveEnvironment} — used by the worker at run time
 * — returns secret values.
 *
 * Secret values are encrypted at rest with the injected {@link Encryptor}
 * (AES-256-GCM). They are sealed on write and only ever decrypted in
 * `resolveEnvironment` (the worker's path); the masked reads never touch the
 * ciphertext. Non-secret variables are stored as-is — they are readable config.
 */
export class SqliteEnvironmentStore implements EnvironmentStore {
  private readonly db: Database;

  constructor(
    dbPath: string,
    private readonly encryptor: Encryptor,
  ) {
    this.db = openDatabase(dbPath);
  }

  async setEnvironment(
    name: string,
    values: SetEnvironmentRequest,
  ): Promise<Environment> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO environments (name, created_at, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET updated_at = excluded.updated_at`,
      )
      .run(name, now, now);

    const upsert = this.db.prepare(
      `INSERT INTO environment_vars (environment_name, key, value, is_secret)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(environment_name, key)
       DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret`,
    );
    // Variables first, then secrets — so a key given as both resolves to secret.
    for (const [key, value] of Object.entries(values.variables)) {
      upsert.run(name, key, value, 0);
    }
    for (const [key, value] of Object.entries(values.secrets)) {
      upsert.run(name, key, this.encryptor.encrypt(value), 1);
    }

    return (await this.getEnvironment(name)) as Environment;
  }

  async getEnvironment(name: string): Promise<Environment | undefined> {
    const row: any = this.db
      .prepare(`SELECT * FROM environments WHERE name = ?`)
      .get(name);
    if (!row) return undefined;
    return this.hydrate(row);
  }

  async listEnvironments(): Promise<Environment[]> {
    const rows: any[] = this.db
      .prepare(`SELECT * FROM environments ORDER BY name ASC`)
      .all();
    return rows.map((row) => this.hydrate(row));
  }

  async deleteEnvironment(name: string): Promise<boolean> {
    // environment_vars cascades via the foreign key.
    const result = this.db
      .prepare(`DELETE FROM environments WHERE name = ?`)
      .run(name);
    return result.changes > 0;
  }

  async resolveEnvironment(
    name: string,
  ): Promise<ResolvedEnvironment | undefined> {
    const exists = this.db
      .prepare(`SELECT 1 FROM environments WHERE name = ?`)
      .get(name);
    if (!exists) return undefined;

    const rows: any[] = this.db
      .prepare(
        `SELECT key, value, is_secret FROM environment_vars WHERE environment_name = ?`,
      )
      .all(name);
    const variables: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const row of rows) {
      if (row.is_secret === 1)
        secrets[row.key] = this.encryptor.decrypt(row.value);
      else variables[row.key] = row.value;
    }
    return { variables, secrets };
  }

  close(): void {
    this.db.close();
  }

  /** Build the masked (no secret values) Environment for an `environments` row. */
  private hydrate(row: {
    name: string;
    created_at: string;
    updated_at: string;
  }): Environment {
    const vars: any[] = this.db
      .prepare(
        `SELECT key, value, is_secret FROM environment_vars
         WHERE environment_name = ? ORDER BY key ASC`,
      )
      .all(row.name);
    const variables: Record<string, string> = {};
    const secretNames: string[] = [];
    for (const v of vars) {
      if (v.is_secret === 1) secretNames.push(v.key);
      else variables[v.key] = v.value;
    }
    return {
      name: row.name,
      variables,
      secretNames,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
