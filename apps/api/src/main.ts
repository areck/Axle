import { LocalArtifactStore } from "@axle/artifacts";
import {
  type SocialProviderCredentials,
  createAuth,
  mintApiKeyForEmail,
} from "@axle/auth";
import { resolveConfig } from "@axle/config";
import {
  Encryptor,
  SqliteEnvironmentStore,
  SqliteExecutionStore,
  openDatabase,
} from "@axle/persistence";
import { AllowAllPolicy } from "./policy";
import { buildServer } from "./server";

function requireEnv(
  value: string | undefined,
  name: string,
  hint: string,
): string {
  if (!value) {
    console.error(`[api] ${name} is required. Generate one: ${hint}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const config = resolveConfig();
  const authSecret = requireEnv(
    config.authSecret,
    "BETTER_AUTH_SECRET",
    "openssl rand -base64 32",
  );
  const secretKey = requireEnv(
    config.secretKey,
    "AXLE_SECRET_KEY",
    "openssl rand -base64 32",
  );

  const store = new SqliteExecutionStore(config.dbPath);
  const environments = new SqliteEnvironmentStore(
    config.dbPath,
    Encryptor.fromBase64(secretKey),
  );
  const artifacts = new LocalArtifactStore(config.artifactsDir);

  // A dedicated DB handle for auth + identity/role lookups.
  const db = openDatabase(config.dbPath);

  // Enable only the social providers that have credentials configured.
  const socialProviders: {
    github?: SocialProviderCredentials;
    google?: SocialProviderCredentials;
  } = {};
  if (config.githubClientId && config.githubClientSecret) {
    socialProviders.github = {
      clientId: config.githubClientId,
      clientSecret: config.githubClientSecret,
    };
  }
  if (config.googleClientId && config.googleClientSecret) {
    socialProviders.google = {
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
    };
  }

  // Deliver magic links via a webhook when configured; otherwise log them (dev),
  // so local sign-in works without any mail infrastructure.
  const sendMagicLink = async ({
    email,
    url,
  }: {
    email: string;
    url: string;
  }): Promise<void> => {
    if (config.magicLinkWebhook) {
      try {
        await fetch(config.magicLinkWebhook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, url }),
        });
      } catch (error) {
        console.error("[api] magic-link webhook failed:", error);
      }
      return;
    }
    console.log(`[api] magic-link for ${email}: ${url}`);
  };

  const auth = createAuth({
    db,
    secret: authSecret,
    baseURL: config.authUrl,
    socialProviders,
    sendMagicLink,
    adminEmails: config.adminEmails,
  });

  // Opt-in headless bootstrap: mint an admin API key for the first allowlisted
  // email and print it once, so automation can obtain a key without a browser.
  if (process.env.AXLE_BOOTSTRAP === "1") {
    const email = config.adminEmails[0];
    if (!email) {
      console.error(
        "[api] AXLE_BOOTSTRAP=1 requires AXLE_ADMIN_EMAILS to be set",
      );
    } else {
      const { key } = await mintApiKeyForEmail(auth, db, {
        email,
        name: "bootstrap-admin",
        role: "admin",
      });
      console.log(
        `[api] bootstrap admin key for ${email} (store as AXLE_API_KEY):\n${key}`,
      );
    }
  }

  const enabled = Object.keys(socialProviders);
  console.log(
    `[api] auth: ${enabled.length ? enabled.join(", ") : "no"} OAuth provider(s); ` +
      `magic link ${config.magicLinkWebhook ? "via webhook" : "logged (dev)"}; ` +
      `${config.adminEmails.length} admin email(s) allowlisted`,
  );

  const app = await buildServer({
    store,
    environments,
    artifacts,
    policy: new AllowAllPolicy(),
    auth,
    db,
    devicePage: {
      github: Boolean(socialProviders.github),
      google: Boolean(socialProviders.google),
    },
  });

  await app.listen({ host: config.apiHost, port: config.apiPort });
  console.log(`[api] Axle API listening on ${config.apiUrl}`);

  const shutdown = async (): Promise<void> => {
    await app.close();
    store.close();
    environments.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[api] fatal:", error);
  process.exit(1);
});
