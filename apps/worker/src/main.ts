import { LocalArtifactStore } from "@axle/artifacts";
import { type RuntimeSelection, resolveConfig } from "@axle/config";
import type { Execution } from "@axle/contracts";
import { DiagnosticsEngine } from "@axle/diagnostics";
import {
  SqliteEnvironmentStore,
  SqliteExecutionStore,
} from "@axle/persistence";
import type { Runtime } from "@axle/runtime";
import { DockerRuntime } from "@axle/runtime-docker";
import { LocalRuntime } from "@axle/runtime-local";
import { ExecutionEngine } from "./engine";

const POLL_INTERVAL_MS = 250;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Prefer stronger isolation (Docker) and fall back to Local when it isn't there. */
async function selectRuntime(preference: RuntimeSelection): Promise<Runtime> {
  const local = new LocalRuntime();
  if (preference === "local") return local;

  const docker = new DockerRuntime();
  if (await docker.isAvailable()) return docker;
  if (preference === "docker") {
    throw new Error(
      "Docker is not available. Start it, or set AXLE_RUNTIME=local.",
    );
  }
  return local;
}

async function main(): Promise<void> {
  const config = resolveConfig();
  const store = new SqliteExecutionStore(config.dbPath);
  const environments = new SqliteEnvironmentStore(config.dbPath);
  const artifacts = new LocalArtifactStore(config.artifactsDir);

  const log = (message: string): void => console.log(`[worker] ${message}`);

  const runtime = await selectRuntime(config.runtime);
  if (runtime.name === "local") {
    console.warn(
      "[worker] Using LocalRuntime — NO isolation. For local development only.",
    );
  }
  log(`started (runtime=${runtime.name}, db=${config.dbPath})`);

  const engine = new ExecutionEngine({
    store,
    environments,
    artifacts,
    runtime,
    diagnostics: new DiagnosticsEngine(),
    logger: log,
  });

  let running = true;
  const stop = (): void => {
    running = false;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (running) {
    let execution: Execution | undefined;
    try {
      execution = await store.claimNextQueued();
    } catch (error) {
      log(`claim failed: ${error}`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (!execution) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    log(`claimed ${execution.id} (${execution.plan.steps.length} steps)`);
    await engine.runExecution(execution);
  }

  store.close();
  environments.close();
  log("stopped");
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
