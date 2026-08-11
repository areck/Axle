import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";

/**
 * Config used ONLY by `auth generate` to derive the Drizzle auth schema from the
 * enabled plugins. Schema generation reads the plugin set, not a live database,
 * so the adapter is handed a stub — this keeps the native driver out of the
 * generator's module graph. The runtime instance lives in `src/auth.ts`.
 */
// biome-ignore lint/suspicious/noExplicitAny: generation stub, never queried.
export const auth = betterAuth({
  secret: "generation-only-not-a-real-secret-000000",
  // biome-ignore lint/suspicious/noExplicitAny: no DB needed to generate schema.
  database: drizzleAdapter({} as any, { provider: "sqlite" }),
  emailAndPassword: { enabled: true },
  plugins: [apiKey(), admin()],
});
