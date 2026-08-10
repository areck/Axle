import type { ArtifactStore } from "@axle/artifacts";
import {
  type CreateExecutionRequest,
  CreateExecutionRequestSchema,
  DEFAULT_PROFILE,
  type Execution,
  type ExecutionPolicy,
  type ExecutionStep,
  ListExecutionsQuerySchema,
  emptyChangeSnapshot,
  emptyMetrics,
  newExecutionId,
  newStepId,
} from "@axle/contracts";
import type { ExecutionStore } from "@axle/persistence";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

export const AXLE_VERSION = "0.1.0";

const SSE_POLL_MS = 200;
const SSE_HEARTBEAT_TICKS = 50; // ~10s at 200ms/tick

export interface ServerDeps {
  store: ExecutionStore;
  artifacts: ArtifactStore;
  policy: ExecutionPolicy;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({
    status: "ok",
    service: "axle-api",
    version: AXLE_VERSION,
  }));

  // Create an execution (queued for the worker to pick up).
  app.post("/v1/executions", async (request, reply) => {
    const parsed = CreateExecutionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid execution request", details: parsed.error.flatten() });
    }

    const decision = await deps.policy.validate(parsed.data);
    if (!decision.allow) {
      return reply
        .code(403)
        .send({ error: "execution rejected by policy", details: decision.reasons });
    }

    const execution = buildExecution(parsed.data);
    await deps.store.createExecution(execution);
    await deps.store.appendEvent({
      type: "execution.status",
      executionId: execution.id,
      status: "queued",
      at: execution.createdAt,
    });
    return reply.code(201).send(execution);
  });

  app.get("/v1/executions", async (request, reply) => {
    const parsed = ListExecutionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid query", details: parsed.error.flatten() });
    }
    return reply.send(await deps.store.listExecutions(parsed.data));
  });

  app.get("/v1/executions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const execution = await deps.store.getExecution(id);
    if (!execution) return reply.code(404).send({ error: "execution not found" });
    return reply.send(execution);
  });

  app.get("/v1/executions/:id/artifacts", async (request, reply) => {
    const { id } = request.params as { id: string };
    const execution = await deps.store.getExecution(id);
    if (!execution) return reply.code(404).send({ error: "execution not found" });
    return reply.send({ artifacts: execution.artifacts });
  });

  // Download an artifact's content.
  app.get("/v1/executions/:id/artifacts/:artifactId", async (request, reply) => {
    const { id, artifactId } = request.params as {
      id: string;
      artifactId: string;
    };
    const execution = await deps.store.getExecution(id);
    if (!execution) return reply.code(404).send({ error: "execution not found" });
    const artifact = execution.artifacts.find((a) => a.id === artifactId);
    if (!artifact) return reply.code(404).send({ error: "artifact not found" });
    if (!(await deps.artifacts.exists(artifact.storageKey))) {
      return reply.code(404).send({ error: "artifact content missing" });
    }
    reply.header("Content-Type", artifact.mimeType ?? "application/octet-stream");
    reply.header(
      "Content-Disposition",
      `attachment; filename="${artifact.name}"`,
    );
    return reply.send(deps.artifacts.createReadStream(artifact.storageKey));
  });

  app.post("/v1/executions/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const execution = await deps.store.getExecution(id);
    if (!execution) return reply.code(404).send({ error: "execution not found" });
    const cancelled = await deps.store.requestCancel(id);
    return reply.send({ cancelled });
  });

  // Stream execution events (Server-Sent Events), replaying history from seq 0.
  app.get("/v1/executions/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const execution = await deps.store.getExecution(id);
    if (!execution) return reply.code(404).send({ error: "execution not found" });

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    raw.write(": connected\n\n");

    let lastSeq = 0;
    let closed = false;
    let idleTicks = 0;
    request.raw.on("close", () => {
      closed = true;
    });

    while (!closed) {
      const events = await deps.store.listEventsSince(id, lastSeq);
      for (const stored of events) {
        lastSeq = stored.seq;
        raw.write(`event: ${stored.event.type}\n`);
        raw.write(`data: ${JSON.stringify(stored.event)}\n\n`);
        if (stored.event.type === "execution.completed") closed = true;
      }
      if (closed) break;
      if (events.length === 0) {
        idleTicks += 1;
        if (idleTicks % SSE_HEARTBEAT_TICKS === 0) raw.write(": ping\n\n");
      } else {
        idleTicks = 0;
      }
      await sleep(SSE_POLL_MS);
    }
    raw.end();
  });

  return app;
}

function buildExecution(request: CreateExecutionRequest): Execution {
  const createdAt = new Date().toISOString();
  const steps: ExecutionStep[] = request.plan.steps.map((planned) => ({
    id: newStepId(),
    plannedStepId: planned.id,
    name: planned.name,
    command: planned.command,
    status: "pending",
  }));
  return {
    id: newExecutionId(),
    repository: request.repository,
    change: request.change ?? emptyChangeSnapshot(),
    intent: request.intent,
    profile: request.profile ?? DEFAULT_PROFILE,
    plan: request.plan,
    status: "queued",
    createdAt,
    steps,
    diagnostics: [],
    artifacts: [],
    metrics: emptyMetrics(),
  };
}
