import { LocalArtifactStore } from "@axle/artifacts";
import { createAuth, ensureAdminUser } from "@axle/auth";
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
  const auth = createAuth({
    db,
    secret: authSecret,
    baseURL: config.authUrl,
  });

  // Seed an admin identity if configured (idempotent).
  if (config.adminEmail && config.adminPassword) {
    const { created } = await ensureAdminUser(auth, db, {
      email: config.adminEmail,
      password: config.adminPassword,
    });
    const state = created ? "created" : "present";
    console.log(
      `[api] admin ${state}: ${config.adminEmail} (run 'axle login' for a key)`,
    );
  }

  const app = await buildServer({
    store,
    environments,
    artifacts,
    policy: new AllowAllPolicy(),
    auth,
    db,
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
