import { LocalArtifactStore } from "@axle/artifacts";
import { resolveConfig } from "@axle/config";
import {
  SqliteEnvironmentStore,
  SqliteExecutionStore,
} from "@axle/persistence";
import { AllowAllPolicy } from "./policy";
import { buildServer } from "./server";

async function main(): Promise<void> {
  const config = resolveConfig();
  const store = new SqliteExecutionStore(config.dbPath);
  const environments = new SqliteEnvironmentStore(config.dbPath);
  const artifacts = new LocalArtifactStore(config.artifactsDir);

  const app = await buildServer({
    store,
    environments,
    artifacts,
    policy: new AllowAllPolicy(),
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
