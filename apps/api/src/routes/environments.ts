import {
  EnvironmentNameSchema,
  SetEnvironmentRequestSchema,
} from "@axle/contracts";
import type { FastifyPluginAsync } from "fastify";
import type { EnvironmentService } from "../environment-service";

/**
 * Routes for `/v1/environments` — the control-plane authority for environments
 * & secrets. Reads return non-secret variables plus secret *names*; secret
 * values are write-only and only ever leave the store via the worker's
 * resolve path, never here.
 */
export function environmentRoutes(
  service: EnvironmentService,
): FastifyPluginAsync {
  return async (app) => {
    app.get("/", async () => {
      return { environments: await service.list() };
    });

    app.get("/:name", async (request, reply) => {
      const { name } = request.params as { name: string };
      const environment = await service.get(name);
      if (!environment) {
        return reply.code(404).send({ error: "environment not found" });
      }
      return reply.send(environment);
    });

    app.put("/:name", async (request, reply) => {
      const { name } = request.params as { name: string };
      if (!EnvironmentNameSchema.safeParse(name).success) {
        return reply.code(400).send({ error: "invalid environment name" });
      }
      const parsed = SetEnvironmentRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid environment",
          details: parsed.error.flatten(),
        });
      }
      return reply.send(await service.set(name, parsed.data));
    });

    app.delete("/:name", async (request, reply) => {
      const { name } = request.params as { name: string };
      if (!(await service.delete(name))) {
        return reply.code(404).send({ error: "environment not found" });
      }
      return reply.send({ deleted: true });
    });
  };
}
