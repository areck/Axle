import { authSchema, openDatabase } from "@axle/persistence";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";

export interface AuthOptions {
  /** Path to the shared Axle SQLite database (holds the auth tables too). */
  dbPath: string;
  /** Signing secret (BETTER_AUTH_SECRET); must be ≥32 chars. */
  secret: string;
  /** Public base URL of the API (BETTER_AUTH_URL), e.g. http://127.0.0.1:8787. */
  baseURL: string;
  trustedOrigins?: string[];
}

/** API-key prefix so Axle keys are recognizable (`axk_…`). */
export const API_KEY_PREFIX = "axk_";

/**
 * Build the Better Auth instance for the control plane.
 *
 * Email/password identities own API keys; the `admin` plugin adds roles
 * (admin/member) that the API authorizes against. Auth data shares the Axle
 * Drizzle database — the tables were generated into `@axle/persistence`'s schema
 * and migrations, so `openDatabase` already creates them.
 */
export function createAuth(options: AuthOptions) {
  const db = openDatabase(options.dbPath);
  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: "/api/auth",
    trustedOrigins: options.trustedOrigins ?? [options.baseURL],
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: authSchema.user,
        session: authSchema.session,
        account: authSchema.account,
        verification: authSchema.verification,
        apikey: authSchema.apikey,
      },
    }),
    emailAndPassword: { enabled: true },
    plugins: [apiKey({ defaultPrefix: API_KEY_PREFIX }), admin()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
