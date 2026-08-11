import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import {
  admin,
  bearer,
  deviceAuthorization,
  magicLink,
} from "better-auth/plugins";

/**
 * Config used ONLY by `auth generate` to derive the Drizzle auth schema from the
 * enabled plugins. Schema generation reads the plugin set, not a live database,
 * so the adapter is handed a stub — this keeps the native driver out of the
 * generator's module graph. The runtime instance lives in `src/auth.ts`, and it
 * MUST enable the same plugins so the generated tables match what it queries.
 */
export const auth = betterAuth({
  secret: "generation-only-not-a-real-secret-000000",
  // biome-ignore lint/suspicious/noExplicitAny: no DB needed to generate schema.
  database: drizzleAdapter({} as any, { provider: "sqlite" }),
  plugins: [
    apiKey(),
    admin(),
    // Passwordless email sign-in; the transport is supplied at runtime.
    magicLink({ sendMagicLink: async () => {} }),
    // OAuth 2.0 Device Authorization Grant — the CLI login flow.
    deviceAuthorization(),
    bearer(),
  ],
});
