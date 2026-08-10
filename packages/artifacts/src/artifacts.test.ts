import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalArtifactStore } from "./local-store";

let baseDir: string;
let store: LocalArtifactStore;

beforeAll(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-artifacts-"));
  store = new LocalArtifactStore(baseDir);
});

afterAll(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

describe("LocalArtifactStore", () => {
  it("stores and reads back an artifact", async () => {
    const ref = await store.put({
      executionId: "exec_abc",
      type: "log",
      name: "execution.log",
      data: "line one\nline two\n",
    });
    expect(ref.storageKey).toBe("exec_abc/execution.log");
    expect(ref.sizeBytes).toBeGreaterThan(0);
    expect(await store.exists(ref.storageKey)).toBe(true);
    const content = await store.read(ref.storageKey);
    expect(content.toString("utf8")).toContain("line two");
  });

  it("rejects keys that escape the base directory", async () => {
    await expect(store.read("../../etc/passwd")).rejects.toThrow();
  });
});
