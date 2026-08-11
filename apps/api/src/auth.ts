import { type Auth, type Identity, verifyApiKeyIdentity } from "@axle/auth";
import type { AxleDatabase } from "@axle/persistence";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the auth hook once a request's API key is verified. */
    identity?: Identity;
  }
}

/** Exact paths reachable without a valid API key. */
const OPEN_PATHS = new Set(["/health", "/device"]);

/**
 * Paths reachable without an Axle API key: `/health`, the device-approval page,
 * and the entire Better Auth surface (`/api/auth/*`), which carries its own auth
 * (OAuth, magic link, sessions, device flow, key minting).
 */
function isOpenPath(pathname: string): boolean {
  if (OPEN_PATHS.has(pathname)) return true;
  return pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

/**
 * Authenticate every `/v1` request with a Better Auth API key (bearer or
 * `x-api-key`) and attach the resolved {@link Identity}. The control plane
 * manages secrets, so it must not be reachable unauthenticated. Route handlers
 * then authorize against `request.identity`.
 */
export function registerAuth(
  app: FastifyInstance,
  auth: Auth,
  db: AxleDatabase,
): void {
  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "OPTIONS") return;
    if (isOpenPath(request.url.split("?")[0])) return;

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
