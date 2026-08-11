import { type Role, setRoleByEmail } from "@axle/auth";
import type { AxleDatabase } from "@axle/persistence";
import type { FastifyPluginAsync } from "fastify";
import { requireAdmin } from "../auth";

/**
 * Routes for `/v1/auth`, all behind the API-key hook. Human sign-in and key
 * minting live on the Better Auth surface (`/api/auth/*`); these are the small
 * Axle-specific additions: report the caller's identity, and let an admin
 * manage roles.
 */
export function authRoutes(db: AxleDatabase): FastifyPluginAsync {
  return async (app) => {
    // Any authenticated caller: report the resolved identity.
    app.get("/whoami", async (request, reply) => {
      return reply.send({ identity: request.identity });
    });

    // Admin-only: set a user's role by email (promote to admin / demote).
    app.post("/roles", async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const body = request.body as { email?: string; role?: string };
      const role: Role | null =
        body?.role === "admin"
          ? "admin"
          : body?.role === "member"
            ? "member"
            : null;
      if (!body?.email || !role) {
        return reply
          .code(400)
          .send({ error: "email and role (admin|member) required" });
      }
      const userId = setRoleByEmail(db, body.email, role);
      if (!userId) return reply.code(404).send({ error: "user not found" });
      return reply.send({ userId, role });
    });
  };
}
