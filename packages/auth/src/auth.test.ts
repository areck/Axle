import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Auth, createAuth } from "./auth";

let dir: string;
let auth: Auth;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-auth-"));
  auth = createAuth({
    dbPath: path.join(dir, "axle.db"),
    secret: "test-secret-test-secret-test-secret-0123",
    baseURL: "http://127.0.0.1:8787",
  });
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("Better Auth", () => {
  it("signs up a user, then issues and verifies an API key", async () => {
    const signUp = await auth.api.signUpEmail({
      body: {
        email: "admin@axle.dev",
        password: "sup3r-secure-pw",
        name: "Admin",
      },
    });
    expect(signUp.user.id).toBeTruthy();

    const created = await auth.api.createApiKey({
      body: { name: "cli", userId: signUp.user.id, prefix: "axk_" },
    });
    expect(created.key).toMatch(/^axk_/);

    const verified = await auth.api.verifyApiKey({
      body: { key: created.key },
    });
    expect(verified.valid).toBe(true);
    // The key resolves back to its owning identity.
    expect(verified.key?.referenceId).toBe(signUp.user.id);
  });

  it("rejects an unknown API key", async () => {
    const verified = await auth.api.verifyApiKey({
      body: { key: "axk_not-a-real-key" },
    });
    expect(verified.valid).toBe(false);
  });
});
