import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalArtifactStore } from "@axle/artifacts";
import { createAuth, mintApiKeyForEmail } from "@axle/auth";
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

const BASE_URL = "http://127.0.0.1:8787";
const origin = { host: "127.0.0.1:8787", origin: BASE_URL };

let dir: string;
let store: SqliteExecutionStore;
let environments: SqliteEnvironmentStore;
let db: AxleDatabase;
let app: FastifyInstance;
let adminKey: string;
let memberKey: string;
let capturedMagicUrl = "";

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

/** Collapse a Set-Cookie response header into a request Cookie header value. */
function cookieHeader(setCookie: string | string[] | undefined): string {
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

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
    baseURL: BASE_URL,
    adminEmails: ["admin@axle.dev", "owner@axle.dev"],
    sendMagicLink: ({ url }) => {
      capturedMagicUrl = url;
    },
  });

  // Passwordless bootstrap: provision identities directly and mint their keys.
  adminKey = (
    await mintApiKeyForEmail(auth, db, {
      email: "admin@axle.dev",
      role: "admin",
    })
  ).key;
  memberKey = (
    await mintApiKeyForEmail(auth, db, {
      email: "member@axle.dev",
      role: "member",
    })
  ).key;

  app = await buildServer({
    store,
    environments,
    artifacts,
    policy: new AllowAllPolicy(),
    auth,
    db,
    devicePage: { github: false, google: false },
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

  it("lets an admin set a role but forbids a member", async () => {
    const asMember = await app.inject({
      method: "POST",
      url: "/v1/auth/roles",
      headers: bearer(memberKey),
      payload: { email: "member@axle.dev", role: "admin" },
    });
    expect(asMember.statusCode).toBe(403);

    const asAdmin = await app.inject({
      method: "POST",
      url: "/v1/auth/roles",
      headers: bearer(adminKey),
      payload: { email: "nobody@axle.dev", role: "admin" },
    });
    expect(asAdmin.statusCode).toBe(404); // no such user, but authorized
  });
});

describe("Better Auth surface (/api/auth)", () => {
  it("serves the device-approval page at /device without a key", async () => {
    const res = await app.inject({ method: "GET", url: "/device" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("is reachable without an API key (get-session)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
    });
    expect(res.statusCode).toBe(200);
  });

  it("issues a device code for the axle-cli client and rejects others", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/api/auth/device/code",
      headers: origin,
      payload: { client_id: "axle-cli" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user_code).toBeTruthy();
    expect(ok.json().verification_uri).toContain("/device");

    const rejected = await app.inject({
      method: "POST",
      url: "/api/auth/device/code",
      headers: origin,
      payload: { client_id: "someone-else" },
    });
    expect(rejected.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("signs in a fresh allowlisted email via magic link → admin key", async () => {
    // 1. Request a magic link; our transport captures the URL.
    const requested = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/magic-link",
      headers: origin,
      payload: { email: "owner@axle.dev", callbackURL: "/" },
    });
    expect(requested.statusCode).toBe(200);
    expect(capturedMagicUrl).toContain("/api/auth/magic-link/verify");

    // 2. Follow the link — this creates the user (allowlist → admin) + a session.
    const verifyUrl = new URL(capturedMagicUrl);
    const verified = await app.inject({
      method: "GET",
      url: verifyUrl.pathname + verifyUrl.search,
      headers: origin,
    });
    const cookie = cookieHeader(verified.headers["set-cookie"]);
    expect(cookie).toBeTruthy();

    // 3. Mint an API key from that session.
    const minted = await app.inject({
      method: "POST",
      url: "/api/auth/api-key/create",
      headers: { ...origin, cookie },
      payload: { name: "owner-cli" },
    });
    expect(minted.statusCode).toBe(200);
    const key = minted.json().key as string;
    expect(key).toMatch(/^axk_/);

    // 4. The allowlisted owner resolves to the admin role.
    const who = await app.inject({
      method: "GET",
      url: "/v1/auth/whoami",
      headers: bearer(key),
    });
    expect(who.statusCode).toBe(200);
    expect(who.json().identity.role).toBe("admin");
  });
});
