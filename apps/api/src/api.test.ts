import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalArtifactStore } from "@axle/artifacts";
import {
  SqliteEnvironmentStore,
  SqliteExecutionStore,
} from "@axle/persistence";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AllowAllPolicy } from "./policy";
import { buildServer } from "./server";

let dir: string;
let store: SqliteExecutionStore;
let environments: SqliteEnvironmentStore;
let app: FastifyInstance;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-api-"));
  store = new SqliteExecutionStore(path.join(dir, "axle.db"));
  environments = new SqliteEnvironmentStore(path.join(dir, "axle.db"));
  const artifacts = new LocalArtifactStore(path.join(dir, "artifacts"));
  app = await buildServer({
    store,
    environments,
    artifacts,
    policy: new AllowAllPolicy(),
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
  it("reports health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: "axle-api" });
  });

  it("creates and retrieves an execution", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/executions",
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
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().intent).toBe("verify the thing");
  });

  it("lists executions", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/executions" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBeGreaterThanOrEqual(1);
  });

  it("rejects an invalid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/executions",
      payload: { repository: { name: "demo" } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for a missing execution", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/executions/exec_nope",
    });
    expect(res.statusCode).toBe(404);
  });

  it("manages environments and never returns secret values", async () => {
    const set = await app.inject({
      method: "PUT",
      url: "/v1/environments/ci",
      payload: {
        variables: { NODE_ENV: "test" },
        secrets: { NPM_TOKEN: "s3cr3t-value" },
      },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().variables).toEqual({ NODE_ENV: "test" });
    expect(set.json().secretNames).toEqual(["NPM_TOKEN"]);
    expect(set.body).not.toContain("s3cr3t-value");

    const get = await app.inject({ method: "GET", url: "/v1/environments/ci" });
    expect(get.statusCode).toBe(200);
    expect(get.body).not.toContain("s3cr3t-value");
    expect(get.json().secretNames).toEqual(["NPM_TOKEN"]);

    const list = await app.inject({ method: "GET", url: "/v1/environments" });
    expect(
      list.json().environments.some((e: { name: string }) => e.name === "ci"),
    ).toBe(true);

    const del = await app.inject({
      method: "DELETE",
      url: "/v1/environments/ci",
    });
    expect(del.statusCode).toBe(200);
    const missing = await app.inject({
      method: "GET",
      url: "/v1/environments/ci",
    });
    expect(missing.statusCode).toBe(404);
  });

  it("rejects an invalid environment name", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/environments/has%20space",
      payload: { variables: {}, secrets: {} },
    });
    expect(res.statusCode).toBe(400);
  });
});
