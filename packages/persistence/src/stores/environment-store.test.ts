import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SqliteEnvironmentStore } from "./environment-store";
import { Encryptor } from "./secret-crypto";

let dir: string;
let dbPath: string;
let store: SqliteEnvironmentStore;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-env-"));
  dbPath = path.join(dir, "axle.db");
  store = new SqliteEnvironmentStore(
    dbPath,
    new Encryptor(crypto.randomBytes(32)),
  );
});

afterAll(async () => {
  store.close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("SqliteEnvironmentStore", () => {
  it("stores variables and secrets; reads never expose secret values", async () => {
    const env = await store.setEnvironment("ci", {
      variables: { NODE_ENV: "test" },
      secrets: { NPM_TOKEN: "s3cr3t-value" },
    });
    expect(env.variables).toEqual({ NODE_ENV: "test" });
    expect(env.secretNames).toEqual(["NPM_TOKEN"]);
    expect(JSON.stringify(env)).not.toContain("s3cr3t-value");

    const fetched = await store.getEnvironment("ci");
    expect(fetched?.secretNames).toEqual(["NPM_TOKEN"]);
    expect(JSON.stringify(fetched)).not.toContain("s3cr3t-value");
  });

  it("resolves secret values for the worker", async () => {
    const resolved = await store.resolveEnvironment("ci");
    expect(resolved).toEqual({
      variables: { NODE_ENV: "test" },
      secrets: { NPM_TOKEN: "s3cr3t-value" },
    });
  });

  it("stores secret values encrypted at rest", () => {
    const raw = new Database(dbPath);
    try {
      const secretRow = raw
        .prepare(
          `SELECT value FROM environment_vars WHERE environment_name = 'ci' AND key = 'NPM_TOKEN'`,
        )
        .get() as { value: string };
      expect(secretRow.value).not.toContain("s3cr3t-value");
      expect(secretRow.value.startsWith("enc:v1:")).toBe(true);

      // A non-secret variable is stored as-is.
      const varRow = raw
        .prepare(
          `SELECT value FROM environment_vars WHERE environment_name = 'ci' AND key = 'NODE_ENV'`,
        )
        .get() as { value: string };
      expect(varRow.value).toBe("test");
    } finally {
      raw.close();
    }
  });

  it("merges on upsert; a key set as a secret leaves the variables", async () => {
    await store.setEnvironment("ci", {
      variables: { EXTRA: "1" },
      secrets: {},
    });
    await store.setEnvironment("ci", {
      variables: {},
      secrets: { NODE_ENV: "now-hidden" },
    });
    const env = await store.getEnvironment("ci");
    expect(env?.variables).toEqual({ EXTRA: "1" });
    expect(env?.secretNames.sort()).toEqual(["NODE_ENV", "NPM_TOKEN"]);
    const resolved = await store.resolveEnvironment("ci");
    expect(resolved?.secrets.NODE_ENV).toBe("now-hidden");
  });

  it("lists and deletes environments", async () => {
    await store.setEnvironment("staging", {
      variables: { A: "b" },
      secrets: {},
    });
    const list = await store.listEnvironments();
    expect(list.map((e) => e.name).sort()).toEqual(["ci", "staging"]);

    expect(await store.deleteEnvironment("staging")).toBe(true);
    expect(await store.deleteEnvironment("staging")).toBe(false);
    expect(await store.getEnvironment("staging")).toBeUndefined();
  });

  it("returns undefined for an unknown environment", async () => {
    expect(await store.getEnvironment("nope")).toBeUndefined();
    expect(await store.resolveEnvironment("nope")).toBeUndefined();
  });
});
