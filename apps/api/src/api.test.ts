import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalArtifactStore } from "@axle/artifacts";
import {
  createAuth,
  createUser,
  ensureAdminUser,
  issueApiKey,
} from "@axle/auth";
import {
  type AxleDatabase,
  Encryptor,
  SqliteEnvironmentStore,
  SqliteExecutionStore,
  closeDatabase,
  openDatabase,
} from "@axle/persistence";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AllowAllPolicy } from "./policy";
import { buildServer } from "./server";

let dir: string;
let store: SqliteExecutionStore;
let environments: SqliteEnvironmentStore;
let db: AxleDatabase;
let app: FastifyInstance;
let adminKey: string;
let memberKey: string;

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-api-"));
  const dbPath = path.join(dir, "axle.db");
  store = new SqliteExecutionStore(dbPath);
  environments = new SqliteEnvironmentStore(
    dbPath,
    new Encryptor(crypto.randomBytes(32)),
  );
  const artifacts = new LocalArtifactStore(path.join(dir, "artifacts"));
  db = openDatabase(dbPath);
  const auth = createAuth({
    db,
    secret: "test-secret-test-secret-test-secret-0123",
    baseURL: "http://127.0.0.1:8787",
  });

  await ensureAdminUser(auth, db, {
    email: "admin@axle.dev",
    password: "admin-pw-12345",
  });
  const adminLogin = await issueApiKey(auth, db, {
    email: "admin@axle.dev",
    password: "admin-pw-12345",
  });
  if (!adminLogin) throw new Error("admin bootstrap failed");
  adminKey = adminLogin.key;

  await createUser(auth, db, {
    email: "member@axle.dev",
    password: "member-pw-12345",
    role: "member",
  });
  const memberLogin = await issueApiKey(auth, db, {
    email: "member@axle.dev",
    password: "member-pw-12345",
  });
  if (!memberLogin) throw new Error("member setup failed");
  memberKey = memberLogin.key;

  app = await buildServer({
    store,
    environments,
    artifacts,
    policy: new AllowAllPolicy(),
    auth,
    db,
  });
});

afterAll(async () => {
  await app.close();
  store.close();
  environments.close();
  closeDatabase(db);
  await fs.rm(dir, { recursive: true, force: true });
});

const validPayload = {
  repository: { name: "demo" },
  intent: "verify the thing",
  plan: {
    profile: "node-22",
    steps: [{ id: "s1", name: "run", command: "echo hi" }],
  },
};

describe("Axle API", () => {
  it("reports health without a key", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: "axle-api" });
  });

  it("requires an API key on /v1 endpoints", async () => {
    const noKey = await app.inject({ method: "GET", url: "/v1/executions" });
    expect(noKey.statusCode).toBe(401);
    const badKey = await app.inject({
      method: "GET",
      url: "/v1/executions",
      headers: bearer("axk_nope"),
    });
    expect(badKey.statusCode).toBe(401);
  });

  it("exchanges credentials for an API key at /v1/auth/token", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/v1/auth/token",
      payload: { email: "admin@axle.dev", password: "admin-pw-12345" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().key).toMatch(/^axk_/);
    expect(ok.json().role).toBe("admin");

    const bad = await app.inject({
      method: "POST",
      url: "/v1/auth/token",
      payload: { email: "admin@axle.dev", password: "wrong" },
    });
    expect(bad.statusCode).toBe(401);
  });

  it("creates and retrieves an execution (authenticated)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: bearer(memberKey),
      payload: validPayload,
    });
    expect(created.statusCode).toBe(201);
    const execution = created.json();
    expect(execution.status).toBe("queued");
    expect(execution.id).toMatch(/^exec_/);

    const fetched = await app.inject({
      method: "GET",
      url: `/v1/executions/${execution.id}`,
      headers: bearer(memberKey),
    });
    expect(fetched.statusCode).toBe(200);
  });

  it("lets an admin write environments but forbids a member (403)", async () => {
    const asAdmin = await app.inject({
      method: "PUT",
      url: "/v1/environments/ci",
      headers: bearer(adminKey),
      payload: {
        variables: { NODE_ENV: "test" },
        secrets: { NPM_TOKEN: "s3cr3t-value" },
      },
    });
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.body).not.toContain("s3cr3t-value");
    expect(asAdmin.json().secretNames).toEqual(["NPM_TOKEN"]);

    const asMember = await app.inject({
      method: "PUT",
      url: "/v1/environments/ci",
      headers: bearer(memberKey),
      payload: { variables: { X: "1" }, secrets: {} },
    });
    expect(asMember.statusCode).toBe(403);

    // A member can still read (secret value never returned).
    const read = await app.inject({
      method: "GET",
      url: "/v1/environments/ci",
      headers: bearer(memberKey),
    });
    expect(read.statusCode).toBe(200);
    expect(read.body).not.toContain("s3cr3t-value");

    const memberDelete = await app.inject({
      method: "DELETE",
      url: "/v1/environments/ci",
      headers: bearer(memberKey),
    });
    expect(memberDelete.statusCode).toBe(403);
  });
});
