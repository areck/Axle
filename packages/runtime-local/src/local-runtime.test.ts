import {
  DEFAULT_LIMITS,
  DEFAULT_PROFILE,
  emptyChangeSnapshot,
} from "@axle/contracts";
import type { RuntimeRequest } from "@axle/runtime";
import { describe, expect, it } from "vitest";
import { LocalRuntime } from "./local-runtime";

const runtime = new LocalRuntime();

function makeRequest(): RuntimeRequest {
  return {
    executionId: "exec_test",
    profile: DEFAULT_PROFILE,
    limits: DEFAULT_LIMITS,
  };
}

describe("LocalRuntime", () => {
  it("is always available", async () => {
    expect(await runtime.isAvailable()).toBe(true);
  });

  it("runs a command and captures stdout + exit code", async () => {
    const env = await runtime.createEnvironment(makeRequest());
    try {
      let out = "";
      const result = await env.run({
        command: "echo hello-axle",
        timeoutSeconds: 30,
        maxOutputBytes: 1_000_000,
        onOutput: (c) => {
          out += c.data;
        },
      });
      expect(result.exitCode).toBe(0);
      expect(out).toContain("hello-axle");
    } finally {
      await env.destroy();
    }
  });

  it("captures non-zero exit codes", async () => {
    const env = await runtime.createEnvironment(makeRequest());
    try {
      const result = await env.run({
        command: "exit 3",
        timeoutSeconds: 30,
        maxOutputBytes: 1000,
      });
      expect(result.exitCode).toBe(3);
    } finally {
      await env.destroy();
    }
  });

  it("enforces a timeout", async () => {
    const env = await runtime.createEnvironment(makeRequest());
    try {
      const result = await env.run({
        command: "sleep 10",
        timeoutSeconds: 1,
        maxOutputBytes: 1000,
      });
      expect(result.timedOut).toBe(true);
    } finally {
      await env.destroy();
    }
  });

  it("truncates output beyond the cap", async () => {
    const env = await runtime.createEnvironment(makeRequest());
    try {
      const result = await env.run({
        command: `node -e "process.stdout.write('x'.repeat(100000))"`,
        timeoutSeconds: 30,
        maxOutputBytes: 1000,
      });
      expect(result.truncated).toBe(true);
      expect(result.outputBytes).toBeLessThanOrEqual(1000);
    } finally {
      await env.destroy();
    }
  });

  it("materializes untracked files into a clean workspace", async () => {
    const env = await runtime.createEnvironment(makeRequest());
    try {
      await env.prepareWorkspace({
        ...emptyChangeSnapshot(),
        untrackedFiles: [
          {
            path: "hello.txt",
            contentBase64: Buffer.from("hi-from-axle").toString("base64"),
            sizeBytes: 12,
          },
        ],
      });
      let out = "";
      const result = await env.run({
        command: "cat hello.txt",
        timeoutSeconds: 30,
        maxOutputBytes: 1000,
        onOutput: (c) => {
          out += c.data;
        },
      });
      expect(result.exitCode).toBe(0);
      expect(out).toContain("hi-from-axle");
    } finally {
      await env.destroy();
    }
  });
});
