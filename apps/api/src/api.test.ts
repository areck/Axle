import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalArtifactStore } from "@axle/artifacts";
import { SqliteExecutionStore } from "@axle/persistence";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AllowAllPolicy } from "./policy";
import { buildServer } from "./server";

let dir: string;
let store: SqliteExecutionStore;
let app: FastifyInstance;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-api-"));
  store = new SqliteExecutionStore(path.join(dir, "axle.db"));
  const artifacts = new LocalArtifactStore(path.join(dir, "artifacts"));
  app = await buildServer({ store, artifacts, policy: new AllowAllPolicy() });
});

afterAll(async () => {
  await app.close();
  store.close();
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
});
