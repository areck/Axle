import {
  CreateExecutionRequestSchema,
  ListExecutionsQuerySchema,
} from "@axle/contracts";
import type { FastifyPluginAsync } from "fastify";
import type { ExecutionService } from "../service";
import { streamEvents } from "../sse";

/**
 * Routes for `/v1/executions`. The handlers own only HTTP concerns —
 * validation, status codes, and streaming — and delegate everything else to the
 * {@link ExecutionService}.
 */
export function executionRoutes(service: ExecutionService): FastifyPluginAsync {
  return async (app) => {
    app.post("/", async (request, reply) => {
      const parsed = CreateExecutionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid execution request",
          details: parsed.error.flatten(),
        });
      }
      const result = await service.create(parsed.data);
      if (!result.ok) {
        return reply.code(403).send({
          error: "execution rejected by policy",
          details: result.reasons,
        });
      }
      return reply.code(201).send(result.execution);
    });

    app.get("/", async (request, reply) => {
      const parsed = ListExecutionsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid query", details: parsed.error.flatten() });
      }
      return reply.send(await service.list(parsed.data));
    });

    app.get("/:id", async (request, reply) => {
      const { id } = request.params as { id: string };
      const execution = await service.get(id);
      if (!execution)
        return reply.code(404).send({ error: "execution not found" });
      return reply.send(execution);
    });

    app.get("/:id/artifacts", async (request, reply) => {
      const { id } = request.params as { id: string };
      const execution = await service.get(id);
      if (!execution)
        return reply.code(404).send({ error: "execution not found" });
      return reply.send({ artifacts: execution.artifacts });
    });

    app.get("/:id/artifacts/:artifactId", async (request, reply) => {
      const { id, artifactId } = request.params as {
        id: string;
        artifactId: string;
      };
      const execution = await service.get(id);
      if (!execution)
        return reply.code(404).send({ error: "execution not found" });
      const opened = await service.openArtifact(execution, artifactId);
      if (!opened) return reply.code(404).send({ error: "artifact not found" });
      reply.header(
        "Content-Type",
        opened.artifact.mimeType ?? "application/octet-stream",
      );
      reply.header(
        "Content-Disposition",
        `attachment; filename="${opened.artifact.name}"`,
      );
      return reply.send(opened.stream);
    });

    app.post("/:id/cancel", async (request, reply) => {
      const { id } = request.params as { id: string };
      const execution = await service.get(id);
      if (!execution)
        return reply.code(404).send({ error: "execution not found" });
      return reply.send({ cancelled: await service.cancel(id) });
    });

    app.get("/:id/events", async (request, reply) => {
      const { id } = request.params as { id: string };
      const execution = await service.get(id);
      if (!execution)
        return reply.code(404).send({ error: "execution not found" });
      await streamEvents(request, reply, (seq) => service.eventsSince(id, seq));
    });
  };
}
