import type {
  Environment,
  ResolvedEnvironment,
  SetEnvironmentRequest,
} from "@axle/contracts";
import { eq } from "drizzle-orm";
import { type AxleDatabase, closeDatabase, openDatabase } from "../db";
import { environmentVars, environments } from "../schema";
import type { EnvironmentStore } from "../types";
import type { Encryptor } from "./secret-crypto";

/**
 * SQLite-backed environments & secrets, on Drizzle + better-sqlite3.
 *
 * Secret values are encrypted at rest with the injected {@link Encryptor}
 * (AES-256-GCM), sealed on write and only decrypted in `resolveEnvironment`
 * (the worker's path); the masked reads never touch the ciphertext. Non-secret
 * variables are stored as-is — they are readable config.
 */
export class SqliteEnvironmentStore implements EnvironmentStore {
  private readonly db: AxleDatabase;

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
      .insert(environments)
      .values({ name, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: environments.name,
        set: { updatedAt: now },
      })
      .run();

    // Variables first, then secrets — so a key given as both resolves to secret.
    const upsert = (key: string, value: string, isSecret: boolean): void => {
      this.db
        .insert(environmentVars)
        .values({ environmentName: name, key, value, isSecret })
        .onConflictDoUpdate({
          target: [environmentVars.environmentName, environmentVars.key],
          set: { value, isSecret },
        })
        .run();
    };
    for (const [key, value] of Object.entries(values.variables)) {
      upsert(key, value, false);
    }
    for (const [key, value] of Object.entries(values.secrets)) {
      upsert(key, this.encryptor.encrypt(value), true);
    }

    return (await this.getEnvironment(name)) as Environment;
  }

  async getEnvironment(name: string): Promise<Environment | undefined> {
    const row = this.db
      .select()
      .from(environments)
      .where(eq(environments.name, name))
      .get();
    return row ? this.hydrate(row) : undefined;
  }

  async listEnvironments(): Promise<Environment[]> {
    return this.db
      .select()
      .from(environments)
      .orderBy(environments.name)
      .all()
      .map((row) => this.hydrate(row));
  }

  async deleteEnvironment(name: string): Promise<boolean> {
    // environment_vars cascades via the foreign key.
    const result = this.db
      .delete(environments)
      .where(eq(environments.name, name))
      .run();
    return result.changes > 0;
  }

  async resolveEnvironment(
    name: string,
  ): Promise<ResolvedEnvironment | undefined> {
    const exists = this.db
      .select({ name: environments.name })
      .from(environments)
      .where(eq(environments.name, name))
      .get();
    if (!exists) return undefined;

    const rows = this.db
      .select()
      .from(environmentVars)
      .where(eq(environmentVars.environmentName, name))
      .all();
    const variables: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const row of rows) {
      if (row.isSecret) secrets[row.key] = this.encryptor.decrypt(row.value);
      else variables[row.key] = row.value;
    }
    return { variables, secrets };
  }

  close(): void {
    closeDatabase(this.db);
  }

  /** Build the masked (no secret values) Environment for an `environments` row. */
  private hydrate(row: typeof environments.$inferSelect): Environment {
    const rows = this.db
      .select()
      .from(environmentVars)
      .where(eq(environmentVars.environmentName, row.name))
      .orderBy(environmentVars.key)
      .all();
    const variables: Record<string, string> = {};
    const secretNames: string[] = [];
    for (const v of rows) {
      if (v.isSecret) secretNames.push(v.key);
      else variables[v.key] = v.value;
    }
    return {
      name: row.name,
      variables,
      secretNames,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
