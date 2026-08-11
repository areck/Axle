import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";

/**
 * Require a bearer token on every request except `/health` (liveness) and CORS
 * preflight. The control plane manages secrets, so it must not be reachable
 * unauthenticated. The token is compared in constant time.
 */
export function registerAuth(app: FastifyInstance, token: string): void {
  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "OPTIONS") return;
    if (request.url.split("?")[0] === "/health") return;

    const header = request.headers.authorization ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!constantTimeEquals(provided, token)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
