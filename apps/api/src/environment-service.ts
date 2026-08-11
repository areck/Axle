import type { Environment, SetEnvironmentRequest } from "@axle/contracts";
import type { EnvironmentStore } from "@axle/persistence";

/**
 * Implementation layer for control-plane environments & secrets. Deliberately
 * thin — it delegates to the store and, crucially, never exposes a path that
 * returns secret *values* (that is `resolveEnvironment`, used only by the
 * worker). Route handlers can only reach the masked reads.
 */
export class EnvironmentService {
  constructor(private readonly store: EnvironmentStore) {}

  set(name: string, values: SetEnvironmentRequest): Promise<Environment> {
    return this.store.setEnvironment(name, values);
  }

  get(name: string): Promise<Environment | undefined> {
    return this.store.getEnvironment(name);
  }

  list(): Promise<Environment[]> {
    return this.store.listEnvironments();
  }

  delete(name: string): Promise<boolean> {
    return this.store.deleteEnvironment(name);
  }
}
