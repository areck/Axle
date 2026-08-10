import type { FastifyPluginAsync } from "fastify";
import { AXLE_VERSION } from "../version";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    status: "ok",
    service: "axle-api",
    version: AXLE_VERSION,
  }));
};
