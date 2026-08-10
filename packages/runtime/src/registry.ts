import type { RuntimeSelection } from "@axle/config";
import { type Runtime, RuntimeUnavailableError } from "./runtime";

/**
 * Holds the available runtime providers and selects one per configuration.
 *
 * Priority for `auto`: prefer stronger isolation (docker) and fall back to the
 * development runtime (local) only when nothing better is available.
 */
const AUTO_PRIORITY = ["docker", "local"] as const;

export class RuntimeRegistry {
  private readonly runtimes = new Map<string, Runtime>();

  register(runtime: Runtime): this {
    this.runtimes.set(runtime.name, runtime);
    return this;
  }

  get(name: string): Runtime | undefined {
    return this.runtimes.get(name);
  }

  list(): Runtime[] {
    return [...this.runtimes.values()];
  }

  /**
   * Resolve a runtime for the given preference. Throws if the requested runtime
   * is unknown or unavailable, so failures surface clearly to the operator.
   */
  async select(preference: RuntimeSelection): Promise<Runtime> {
    if (preference !== "auto") {
      const runtime = this.runtimes.get(preference);
      if (!runtime) {
        throw new RuntimeUnavailableError(
          preference,
          `Runtime "${preference}" is not registered.`,
        );
      }
      if (!(await runtime.isAvailable())) {
        throw new RuntimeUnavailableError(
          preference,
          `Runtime "${preference}" is registered but not available on this host.`,
        );
      }
      return runtime;
    }

    for (const name of AUTO_PRIORITY) {
      const runtime = this.runtimes.get(name);
      if (runtime && (await runtime.isAvailable())) {
        return runtime;
      }
    }

    throw new RuntimeUnavailableError(
      "auto",
      "No execution runtime is available. Start Docker, or set AXLE_RUNTIME=local.",
    );
  }
}
