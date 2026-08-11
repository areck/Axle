import type { ArtifactStore } from "@axle/artifacts";
import type { ExecutionPolicy } from "@axle/contracts";
import type { EnvironmentStore, ExecutionStore } from "@axle/persistence";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { EnvironmentService } from "./environment-service";
import { environmentRoutes } from "./routes/environments";
import { executionRoutes } from "./routes/executions";
import { healthRoutes } from "./routes/health";
import { ExecutionService } from "./service";

export { AXLE_VERSION } from "./version";

export interface ServerDeps {
  store: ExecutionStore;
  environments: EnvironmentStore;
  artifacts: ArtifactStore;
  policy: ExecutionPolicy;
}

/**
 * Compose the Axle API: CORS, the execution service (implementation), and the
 * route plugins (interface). Adding a resource means registering another route
 * plugin here — no handler lives in this file.
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });
  await app.register(cors, { origin: true });

  const service = new ExecutionService(deps.store, deps.artifacts, deps.policy);
  const environments = new EnvironmentService(deps.environments);

  await app.register(healthRoutes);
  await app.register(executionRoutes(service), { prefix: "/v1/executions" });
  await app.register(environmentRoutes(environments), {
    prefix: "/v1/environments",
  });

  return app;
}
