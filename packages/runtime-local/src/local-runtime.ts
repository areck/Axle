import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChangeSnapshot } from "@axle/contracts";
import type {
  CollectedArtifact,
  CommandRequest,
  CommandResult,
  ExecutionEnvironment,
  OutputChunk,
  Runtime,
  RuntimeRequest,
} from "@axle/runtime";
import { buildSandboxEnv } from "./env";

let warnedAboutIsolation = false;

/** Grace period between SIGTERM and SIGKILL when killing a timed-out command. */
const TERM_GRACE_MS = 3000;

/**
 * An execution environment backed by a throwaway temp directory on the host.
 *
 * WARNING: this provides no isolation. It exists so the full Axle flow can run
 * on machines without Docker (and in CI). Never run untrusted code through it.
 */
class LocalExecutionEnvironment implements ExecutionEnvironment {
  constructor(
    readonly id: string,
    private readonly workdir: string,
    private readonly baseEnv: Record<string, string>,
  ) {}

  async prepareWorkspace(snapshot: ChangeSnapshot): Promise<void> {
    for (const file of snapshot.untrackedFiles ?? []) {
      const dest = this.resolveInsideWorkspace(file.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, Buffer.from(file.contentBase64, "base64"));
      if (typeof file.mode === "number") {
        await fs.chmod(dest, file.mode);
      }
    }

    const patch = snapshot.patch?.trim();
    if (patch && patch.length > 0) {
      const patchPath = path.join(this.workdir, ".axle-change.patch");
      await fs.writeFile(patchPath, snapshot.patch);
      const { result, output } = await this.spawn({
        command: `git apply --whitespace=nowarn "${patchPath}"`,
        timeoutSeconds: 120,
        maxOutputBytes: 1_000_000,
      });
      await fs.rm(patchPath, { force: true });
      if (result.exitCode !== 0) {
        throw new Error(
          `Failed to apply change patch in workspace (exit ${result.exitCode}).\n${output}`,
        );
      }
    }
  }

  async run(command: CommandRequest): Promise<CommandResult> {
    const { result } = await this.spawn(command);
    return result;
  }

  async collectArtifacts(): Promise<CollectedArtifact[]> {
    // The engine writes the execution.log artifact directly. Collecting build
    // outputs / reports from the workspace arrives in a later pass.
    return [];
  }

  async destroy(): Promise<void> {
    await fs.rm(this.workdir, { recursive: true, force: true });
  }

  private resolveInsideWorkspace(relativePath: string): string {
    const root = path.resolve(this.workdir);
    const dest = path.resolve(root, relativePath);
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      throw new Error(
        `Refusing to touch a path outside the workspace: ${relativePath}`,
      );
    }
    return dest;
  }

  private spawn(
    command: CommandRequest,
  ): Promise<{ result: CommandResult; output: string }> {
    const cwd = command.cwd
      ? this.resolveInsideWorkspace(command.cwd)
      : this.workdir;
    const env = { ...this.baseEnv, ...(command.env ?? {}) };
    const startedAt = Date.now();

    return new Promise((resolve) => {
      const child = spawn(command.command, {
        cwd,
        env,
        shell: true,
        detached: process.platform !== "win32",
      });

      let outputBytes = 0;
      let truncated = false;
      let captured = "";
      const maxOutput = command.maxOutputBytes;

      const handleChunk = (stream: OutputChunk["stream"], buf: Buffer) => {
        const remaining = maxOutput - outputBytes;
        if (remaining <= 0) {
          truncated = true;
          return;
        }
        let slice = buf;
        if (buf.byteLength > remaining) {
          slice = buf.subarray(0, remaining);
          truncated = true;
        }
        const text = slice.toString("utf8");
        outputBytes += slice.byteLength;
        captured += text;
        command.onOutput?.({ stream, data: text });
      };

      child.stdout?.on("data", (b: Buffer) => handleChunk("stdout", b));
      child.stderr?.on("data", (b: Buffer) => handleChunk("stderr", b));

      let timedOut = false;
      let settled = false;
      let escalationTimer: NodeJS.Timeout | undefined;

      const killGroup = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== "win32" && child.pid) {
            process.kill(-child.pid, signal);
          } else {
            child.kill(signal);
          }
        } catch {
          // Process group already gone.
        }
      };

      const escalate = () => {
        killGroup("SIGTERM");
        escalationTimer = setTimeout(() => killGroup("SIGKILL"), TERM_GRACE_MS);
        escalationTimer.unref?.();
      };

      const timer = setTimeout(() => {
        timedOut = true;
        escalate();
      }, command.timeoutSeconds * 1000);
      timer.unref?.();

      const onAbort = () => escalate();
      command.signal?.addEventListener("abort", onAbort, { once: true });

      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (escalationTimer) clearTimeout(escalationTimer);
        command.signal?.removeEventListener("abort", onAbort);
        resolve({
          result: {
            exitCode,
            timedOut,
            durationMs: Date.now() - startedAt,
            outputBytes,
            truncated,
          },
          output: captured,
        });
      };

      child.on("error", (err: Error) => {
        handleChunk("stderr", Buffer.from(`${err.message}\n`));
        finish(null);
      });
      child.on("close", (code) => finish(code));
    });
  }
}

/**
 * The local development runtime. Always available; no isolation.
 */
export class LocalRuntime implements Runtime {
  readonly name = "local";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createEnvironment(
    request: RuntimeRequest,
  ): Promise<ExecutionEnvironment> {
    if (!warnedAboutIsolation) {
      warnedAboutIsolation = true;
      console.warn(
        "[axle] LocalRuntime provides NO isolation and runs commands directly " +
          "on this host. Use it only for local development against trusted code.",
      );
    }
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), `axle-${request.executionId}-`),
    );
    return new LocalExecutionEnvironment(
      `local_${randomUUID()}`,
      dir,
      buildSandboxEnv(request.env),
    );
  }
}
