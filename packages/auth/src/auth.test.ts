import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AxleDatabase,
  closeDatabase,
  openDatabase,
} from "@axle/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Auth, createAuth, resolveRole } from "./auth";
import {
  ensureUser,
  mintApiKeyForEmail,
  roleOf,
  setRoleByEmail,
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
    adminEmails: ["admin@axle.dev"],
  });
});

afterAll(async () => {
  closeDatabase(db);
  await fs.rm(dir, { recursive: true, force: true });
});

describe("resolveRole (admin allowlist)", () => {
  it("grants admin only to allowlisted emails, case-insensitively", () => {
    const allow = ["Admin@Axle.dev", " ops@axle.dev "];
    expect(resolveRole("admin@axle.dev", allow)).toBe("admin");
    expect(resolveRole("OPS@axle.dev", allow)).toBe("admin");
    expect(resolveRole("someone@axle.dev", allow)).toBe("member");
    expect(resolveRole("admin@axle.dev", [])).toBe("member");
  });
});

describe("passwordless identities", () => {
  it("provisions an admin whose minted key resolves to the admin role", async () => {
    const { key, identity } = await mintApiKeyForEmail(auth, db, {
      email: "admin@axle.dev",
      role: "admin",
    });
    expect(key).toMatch(/^axk_/);
    expect(identity.role).toBe("admin");

    expect(await verifyApiKeyIdentity(auth, db, key)).toEqual({
      userId: identity.userId,
      role: "admin",
    });
  });

  it("provisions a member whose key resolves to the member role", async () => {
    const { key, identity } = await mintApiKeyForEmail(auth, db, {
      email: "member@axle.dev",
      role: "member",
    });
    expect(identity.role).toBe("member");
    expect(await verifyApiKeyIdentity(auth, db, key)).toEqual({
      userId: identity.userId,
      role: "member",
    });
  });

  it("is idempotent: the same email reuses one identity", () => {
    const first = ensureUser(db, { email: "dup@axle.dev", role: "member" });
    const second = ensureUser(db, { email: "dup@axle.dev", role: "member" });
    expect(first).toBe(second);
  });

  it("lets an admin promote and demote a user by email", () => {
    const userId = ensureUser(db, {
      email: "promote@axle.dev",
      role: "member",
    });
    expect(setRoleByEmail(db, "promote@axle.dev", "admin")).toBe(userId);
    expect(roleOf(db, userId)).toBe("admin");
    setRoleByEmail(db, "promote@axle.dev", "member");
    expect(roleOf(db, userId)).toBe("member");
    expect(setRoleByEmail(db, "nobody@axle.dev", "admin")).toBeNull();
  });

  it("rejects an unknown API key", async () => {
    expect(await verifyApiKeyIdentity(auth, db, "axk_nope")).toBeNull();
  });
});
