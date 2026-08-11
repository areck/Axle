import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalArtifactStore } from "@axle/artifacts";
import {
  Encryptor,
  SqliteEnvironmentStore,
  SqliteExecutionStore,
} from "@axle/persistence";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AllowAllPolicy } from "./policy";
import { buildServer } from "./server";

const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };

let dir: string;
let store: SqliteExecutionStore;
let environments: SqliteEnvironmentStore;
let app: FastifyInstance;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-api-"));
  store = new SqliteExecutionStore(path.join(dir, "axle.db"));
  environments = new SqliteEnvironmentStore(
    path.join(dir, "axle.db"),
    new Encryptor(crypto.randomBytes(32)),
  );
  const artifacts = new LocalArtifactStore(path.join(dir, "artifacts"));
  app = await buildServer({
    store,
    environments,
    artifacts,
    policy: new AllowAllPolicy(),
    token: TOKEN,
  });
});

afterAll(async () => {
  await app.close();
  store.close();
  environments.close();
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
  it("reports health without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: "axle-api" });
  });

  it("requires a bearer token on /v1 endpoints", async () => {
    const noToken = await app.inject({
      method: "GET",
      url: "/v1/executions",
    });
    expect(noToken.statusCode).toBe(401);

    const wrongToken = await app.inject({
      method: "GET",
      url: "/v1/executions",
      headers: { authorization: "Bearer nope" },
    });
    expect(wrongToken.statusCode).toBe(401);
  });

  it("creates and retrieves an execution", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: auth,
      payload: validPayload,
    });
    expect(created.statusCode).toBe(201);
    const execution = created.json();
    expect(execution.status).toBe("queued");
    expect(execution.steps).toHaveLength(1);
    expect(execution.id).toMatch(/^exec_/);

    const fetched = await app.inject({
      method: "GET",
      url: `/v1/executions/${execution.id}`,
      headers: auth,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().intent).toBe("verify the thing");
  });

  it("lists executions", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/executions",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBeGreaterThanOrEqual(1);
  });

  it("rejects an invalid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: auth,
      payload: { repository: { name: "demo" } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for a missing execution", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/executions/exec_nope",
      headers: auth,
    });
    expect(res.statusCode).toBe(404);
  });

  it("manages environments and never returns secret values", async () => {
    const set = await app.inject({
      method: "PUT",
      url: "/v1/environments/ci",
      headers: auth,
      payload: {
        variables: { NODE_ENV: "test" },
        secrets: { NPM_TOKEN: "s3cr3t-value" },
      },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().variables).toEqual({ NODE_ENV: "test" });
    expect(set.json().secretNames).toEqual(["NPM_TOKEN"]);
    expect(set.body).not.toContain("s3cr3t-value");

    const get = await app.inject({
      method: "GET",
      url: "/v1/environments/ci",
      headers: auth,
    });
    expect(get.statusCode).toBe(200);
    expect(get.body).not.toContain("s3cr3t-value");
    expect(get.json().secretNames).toEqual(["NPM_TOKEN"]);

    const list = await app.inject({
      method: "GET",
      url: "/v1/environments",
      headers: auth,
    });
    expect(
      list.json().environments.some((e: { name: string }) => e.name === "ci"),
    ).toBe(true);

    const del = await app.inject({
      method: "DELETE",
      url: "/v1/environments/ci",
      headers: auth,
    });
    expect(del.statusCode).toBe(200);
    const missing = await app.inject({
      method: "GET",
      url: "/v1/environments/ci",
      headers: auth,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("rejects an invalid environment name", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/environments/has%20space",
      headers: auth,
      payload: { variables: {}, secrets: {} },
    });
    expect(res.statusCode).toBe(400);
  });
});
