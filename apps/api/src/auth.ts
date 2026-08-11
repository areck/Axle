import { type Auth, type Identity, verifyApiKeyIdentity } from "@axle/auth";
import type { AxleDatabase } from "@axle/persistence";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the auth hook once a request's API key is verified. */
    identity?: Identity;
  }
}

/** Paths reachable without a valid API key. */
const OPEN_PATHS = new Set(["/health", "/v1/auth/token"]);

/**
 * Authenticate every request with a Better Auth API key (bearer or `x-api-key`)
 * and attach the resolved {@link Identity}. The control plane manages secrets,
 * so it must not be reachable unauthenticated — only `/health` and the login
 * exchange are open. Route handlers then authorize against `request.identity`.
 */
export function registerAuth(
  app: FastifyInstance,
  auth: Auth,
  db: AxleDatabase,
): void {
  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "OPTIONS") return;
    if (OPEN_PATHS.has(request.url.split("?")[0])) return;

    const key = presentedKey(request);
    if (!key) return reply.code(401).send({ error: "unauthorized" });
    const identity = await verifyApiKeyIdentity(auth, db, key);
    if (!identity) return reply.code(401).send({ error: "unauthorized" });
    request.identity = identity;
  });
}

/**
 * Require the caller to be an admin. Returns true when allowed; otherwise sends
 * 403 and returns false, so a handler can `if (!requireAdmin(...)) return;`.
 */
export function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  if (request.identity?.role !== "admin") {
    reply.code(403).send({
      error: "forbidden",
      detail: "admin role required",
    });
    return false;
  }
  return true;
}

function presentedKey(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const apiKeyHeader = request.headers["x-api-key"];
  return typeof apiKeyHeader === "string" ? apiKeyHeader : undefined;
}
