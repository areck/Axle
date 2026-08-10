import type { ChangeSnapshot } from "@axle/contracts";
import type {
  CollectedArtifact,
  CommandRequest,
  CommandResult,
  RuntimeRequest,
} from "./types";

/**
 * A provider capable of creating isolated execution environments.
 *
 * This is the seam that lets Docker later be replaced or augmented by Daytona,
 * E2B, Kubernetes, Firecracker, cloud VMs, or macOS/Windows workers without
 * touching the product layer.
 */
export interface Runtime {
  readonly name: string;
  /** Whether this runtime can currently create environments on this host. */
  isAvailable(): Promise<boolean>;
  createEnvironment(request: RuntimeRequest): Promise<ExecutionEnvironment>;
}

/**
 * A single, ephemeral place to prepare a workspace and run commands.
 *
 * Lifecycle: create -> prepareWorkspace -> run* -> collectArtifacts -> destroy.
 * `destroy()` must always be called (the engine guarantees it with `finally`).
 */
export interface ExecutionEnvironment {
  readonly id: string;
  /** Materialize the agent's change into a clean workspace. */
  prepareWorkspace(snapshot: ChangeSnapshot): Promise<void>;
  /** Run a single command, streaming output via `onOutput`. */
  run(command: CommandRequest): Promise<CommandResult>;
  /** Gather requested output files as artifacts. */
  collectArtifacts(): Promise<CollectedArtifact[]>;
  /** Tear down the environment and release all resources. */
  destroy(): Promise<void>;
}

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}

export class RuntimeUnavailableError extends Error {
  constructor(
    public readonly runtimeName: string,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeUnavailableError";
  }
}
