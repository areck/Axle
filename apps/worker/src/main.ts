import { LocalArtifactStore } from "@axle/artifacts";
import { resolveConfig } from "@axle/config";
import { DiagnosticsEngine } from "@axle/diagnostics";
import { SqliteExecutionStore } from "@axle/persistence";
import { RuntimeRegistry } from "@axle/runtime";
import { DockerRuntime } from "@axle/runtime-docker";
import { LocalRuntime } from "@axle/runtime-local";
import { ExecutionEngine } from "./engine";

const POLL_INTERVAL_MS = 250;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const config = resolveConfig();
  const store = new SqliteExecutionStore(config.dbPath);
  const artifacts = new LocalArtifactStore(config.artifactsDir);
  const registry = new RuntimeRegistry()
    .register(new DockerRuntime())
    .register(new LocalRuntime());

  const log = (message: string): void => console.log(`[worker] ${message}`);

  const runtime = await registry.select(config.runtime);
  if (runtime.name === "local") {
    console.warn(
      "[worker] Using LocalRuntime — NO isolation. For local development only.",
    );
  }
  log(`started (runtime=${runtime.name}, db=${config.dbPath})`);

  const engine = new ExecutionEngine({
    store,
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
    let execution;
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
  log("stopped");
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
