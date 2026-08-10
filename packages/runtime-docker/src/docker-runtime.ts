import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  type ExecutionEnvironment,
  NotImplementedError,
  type Runtime,
  type RuntimeRequest,
} from "@axle/runtime";

const execFileAsync = promisify(execFile);

/**
 * The intended production runtime: each execution runs in a clean, ephemeral,
 * resource-limited container.
 *
 * In this bootstrap pass the container lifecycle is stubbed behind the Runtime
 * interface — `isAvailable()` is real (it pings the daemon so `axle doctor` and
 * `auto` selection behave correctly), while `createEnvironment()` is not yet
 * implemented. See this package's README for the planned implementation and the
 * security properties it must enforce.
 */
export class DockerRuntime implements Runtime {
  readonly name = "docker";

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  async createEnvironment(
    _request: RuntimeRequest,
  ): Promise<ExecutionEnvironment> {
    throw new NotImplementedError(
      "DockerRuntime.createEnvironment (isolated container execution)",
    );
  }
}
