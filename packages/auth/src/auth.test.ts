import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AxleDatabase,
  closeDatabase,
  openDatabase,
} from "@axle/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Auth, createAuth } from "./auth";
import {
  createUser,
  ensureAdminUser,
  issueApiKey,
  verifyApiKeyIdentity,
} from "./identity";

let dir: string;
let db: AxleDatabase;
let auth: Auth;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axle-auth-"));
  db = openDatabase(path.join(dir, "axle.db"));
  auth = createAuth({
    db,
    secret: "test-secret-test-secret-test-secret-0123",
    baseURL: "http://127.0.0.1:8787",
  });
});

afterAll(async () => {
  closeDatabase(db);
  await fs.rm(dir, { recursive: true, force: true });
});

describe("Better Auth identity", () => {
  it("bootstraps an admin and resolves its key to an admin identity", async () => {
    const { userId, created } = await ensureAdminUser(auth, db, {
      email: "admin@axle.dev",
      password: "sup3r-secure-pw",
      name: "Admin",
    });
    expect(created).toBe(true);

    const login = await issueApiKey(auth, db, {
      email: "admin@axle.dev",
      password: "sup3r-secure-pw",
    });
    expect(login?.key).toMatch(/^axk_/);
    expect(login?.identity.role).toBe("admin");

    const key = login?.key ?? "";
    expect(await verifyApiKeyIdentity(auth, db, key)).toEqual({
      userId,
      role: "admin",
    });
  });

  it("creates a member whose key resolves to the member role", async () => {
    const memberId = await createUser(auth, db, {
      email: "member@axle.dev",
      password: "member-pw-123",
      role: "member",
    });
    const login = await issueApiKey(auth, db, {
      email: "member@axle.dev",
      password: "member-pw-123",
    });
    expect(login?.identity).toEqual({ userId: memberId, role: "member" });
  });

  it("rejects an unknown key and bad credentials", async () => {
    expect(await verifyApiKeyIdentity(auth, db, "axk_nope")).toBeNull();
    expect(
      await issueApiKey(auth, db, {
        email: "admin@axle.dev",
        password: "wrong-password",
      }),
    ).toBeNull();
  });
});
