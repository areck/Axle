import { type Auth, createUser, issueApiKey } from "@axle/auth";
import type { AxleDatabase } from "@axle/persistence";
import type { FastifyPluginAsync } from "fastify";
import { requireAdmin } from "../auth";

/**
 * Routes for `/v1/auth`. `token` is open (it *is* the login); the rest run
 * behind the API-key auth hook, and `users` additionally requires admin.
 */
export function authRoutes(auth: Auth, db: AxleDatabase): FastifyPluginAsync {
  return async (app) => {
    // Exchange email/password for an API key — the CLI login.
    app.post("/token", async (request, reply) => {
      const body = request.body as { email?: string; password?: string };
      if (!body?.email || !body?.password) {
        return reply.code(400).send({ error: "email and password required" });
      }
      const issued = await issueApiKey(auth, db, {
        email: body.email,
        password: body.password,
      });
      if (!issued)
        return reply.code(401).send({ error: "invalid credentials" });
      return reply.send({ key: issued.key, role: issued.identity.role });
    });

    // Admin-only: provision a user with a role.
    app.post("/users", async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const body = request.body as {
        email?: string;
        password?: string;
        name?: string;
        role?: string;
      };
      if (!body?.email || !body?.password) {
        return reply.code(400).send({ error: "email and password required" });
      }
      const role = body.role === "admin" ? "admin" : "member";
      const userId = await createUser(auth, db, {
        email: body.email,
        password: body.password,
        name: body.name,
        role,
      });
      return reply.code(201).send({ userId, role });
    });

    // Any authenticated caller: report the resolved identity.
    app.get("/whoami", async (request, reply) => {
      return reply.send({ identity: request.identity });
    });
  };
}
