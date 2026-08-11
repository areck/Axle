import type { AxleDatabase } from "@axle/persistence";
import { authSchema } from "@axle/persistence";
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import {
  admin,
  bearer,
  deviceAuthorization,
  magicLink,
} from "better-auth/plugins";

/** OAuth client id the Axle CLI presents on the device-authorization flow. */
export const CLI_CLIENT_ID = "axle-cli";

/** API-key prefix so Axle keys are recognizable (`axk_…`). */
export const API_KEY_PREFIX = "axk_";

/** Credentials for one social (OAuth) identity provider. */
export interface SocialProviderCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * The role a newly signed-in `email` should receive: `admin` when it's on the
 * allowlist, otherwise `member` (the least-privileged default). Matching is
 * case-insensitive and trims surrounding whitespace.
 */
export function resolveRole(
  email: string,
  adminEmails: Iterable<string>,
): "admin" | "member" {
  const allow = new Set(
    [...adminEmails].map((entry) => entry.trim().toLowerCase()),
  );
  return allow.has(email.trim().toLowerCase()) ? "admin" : "member";
}

export interface AuthOptions {
  /** The shared Axle Drizzle database (holds the auth tables too). */
  db: AxleDatabase;
  /** Signing secret (BETTER_AUTH_SECRET); must be ≥32 chars. */
  secret: string;
  /** Public base URL of the API (BETTER_AUTH_URL), e.g. http://127.0.0.1:8787. */
  baseURL: string;
  trustedOrigins?: string[];
  /**
   * Social providers to enable — include only those with credentials. When a
   * provider is absent its sign-in button/route simply isn't offered.
   */
  socialProviders?: {
    github?: SocialProviderCredentials;
    google?: SocialProviderCredentials;
  };
  /**
   * Deliver a passwordless magic-link sign-in URL. In production this emails the
   * link; in local dev the API logs it to the console so sign-in works without
   * any mail infrastructure. When omitted, magic-link requests are accepted but
   * the link is dropped (dev fallback logs a warning).
   */
  sendMagicLink?: (args: {
    email: string;
    url: string;
    token: string;
  }) => Promise<void> | void;
  /** Emails granted the `admin` role on first sign-in (lower-cased allowlist). */
  adminEmails?: string[];
}

/**
 * Build the Better Auth instance for the control plane.
 *
 * Human identities are **passwordless**: they authenticate with a social OAuth
 * provider (GitHub/Google) or an email magic link. The CLI authenticates with
 * the OAuth 2.0 Device Authorization Grant and then mints an `apiKey` (`axk_…`)
 * — the credential agents and CI present on every `/v1` request. The `admin`
 * plugin adds roles (admin/member) the API authorizes against; admins are
 * designated by the `adminEmails` allowlist at first sign-in.
 *
 * Auth data shares the Axle Drizzle database — the tables were generated into
 * `@axle/persistence`'s schema and migrations, so the passed `db` has them.
 */
export function createAuth(options: AuthOptions) {
  const adminEmails = options.adminEmails ?? [];

  const socialProviders: Record<string, SocialProviderCredentials> = {};
  if (options.socialProviders?.github) {
    socialProviders.github = options.socialProviders.github;
  }
  if (options.socialProviders?.google) {
    socialProviders.google = options.socialProviders.google;
  }

  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: "/api/auth",
    trustedOrigins: options.trustedOrigins ?? [options.baseURL],
    database: drizzleAdapter(options.db, {
      provider: "sqlite",
      schema: {
        user: authSchema.user,
        session: authSchema.session,
        account: authSchema.account,
        verification: authSchema.verification,
        apikey: authSchema.apikey,
        deviceCode: authSchema.deviceCode,
      },
    }),
    socialProviders,
    databaseHooks: {
      user: {
        create: {
          // Assign the role at creation from the admin allowlist. Everyone else
          // is a member — the least-privileged default.
          before: async (user) => {
            return {
              data: { ...user, role: resolveRole(user.email, adminEmails) },
            };
          },
        },
      },
    },
    plugins: [
      apiKey({ defaultPrefix: API_KEY_PREFIX }),
      admin({ defaultRole: "member", adminRoles: ["admin"] }),
      magicLink({
        sendMagicLink: async ({ email, url, token }) => {
          if (options.sendMagicLink) {
            await options.sendMagicLink({ email, url, token });
            return;
          }
          console.warn(
            `[auth] no magic-link transport configured; dropping link for ${email}`,
          );
        },
      }),
      deviceAuthorization({
        // Only the first-party Axle CLI may run the device flow.
        validateClient: (clientId) => clientId === CLI_CLIENT_ID,
      }),
      // Let a session token authenticate via `Authorization: Bearer` — the CLI
      // presents the device-flow token once, to mint its `axk_` API key.
      bearer(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
