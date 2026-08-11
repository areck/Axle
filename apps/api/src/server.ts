import type { ArtifactStore } from "@axle/artifacts";
import type { Auth } from "@axle/auth";
import type { ExecutionPolicy } from "@axle/contracts";
import type {
  AxleDatabase,
  EnvironmentStore,
  ExecutionStore,
} from "@axle/persistence";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuth } from "./auth";
import { EnvironmentService } from "./environment-service";
import { authRoutes } from "./routes/auth";
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
  /** Better Auth instance and the DB it resolves identities/roles against. */
  auth: Auth;
  db: AxleDatabase;
}

/**
 * Compose the Axle API: CORS, API-key auth, the execution service, and the
 * route plugins. Adding a resource means registering another route plugin here
 * — no handler lives in this file.
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  registerAuth(app, deps.auth, deps.db);

  const service = new ExecutionService(deps.store, deps.artifacts, deps.policy);
  const environments = new EnvironmentService(deps.environments);

  await app.register(healthRoutes);
  await app.register(authRoutes(deps.auth, deps.db), { prefix: "/v1/auth" });
  await app.register(executionRoutes(service), { prefix: "/v1/executions" });
  await app.register(environmentRoutes(environments), {
    prefix: "/v1/environments",
  });

  return app;
}
