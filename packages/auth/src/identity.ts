import { type AxleDatabase, authSchema } from "@axle/persistence";
import { eq } from "drizzle-orm";
import type { Auth } from "./auth";

export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];

/** The authenticated caller behind a request: who they are and their role. */
export interface Identity {
  userId: string;
  role: Role;
}

/** Anything not explicitly "admin" is a member — the least-privileged default. */
function normalizeRole(role: string | null | undefined): Role {
  return role === "admin" ? "admin" : "member";
}

function roleOf(db: AxleDatabase, userId: string): Role {
  const row = db
    .select({ role: authSchema.user.role })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .get();
  return normalizeRole(row?.role);
}

/** Verify a presented API key and resolve it to an identity (owner + role). */
export async function verifyApiKeyIdentity(
  auth: Auth,
  db: AxleDatabase,
  key: string,
): Promise<Identity | null> {
  const result = await auth.api.verifyApiKey({ body: { key } });
  if (!result.valid || !result.key) return null;
  const userId = result.key.referenceId;
  return { userId, role: roleOf(db, userId) };
}

/**
 * Exchange email/password for a fresh API key — the CLI login. Returns null on
 * bad credentials.
 */
export async function issueApiKey(
  auth: Auth,
  db: AxleDatabase,
  credentials: { email: string; password: string },
): Promise<{ key: string; identity: Identity } | null> {
  let userId: string;
  try {
    const signIn = await auth.api.signInEmail({
      body: { email: credentials.email, password: credentials.password },
    });
    if (!signIn?.user) return null;
    userId = signIn.user.id;
  } catch {
    return null; // invalid credentials
  }
  const created = await auth.api.createApiKey({
    body: { userId, name: `cli:${credentials.email}` },
  });
  return { key: created.key, identity: { userId, role: roleOf(db, userId) } };
}

/**
 * Ensure an admin identity exists (idempotent) — used to bootstrap the control
 * plane. Creates the user if absent and (re)asserts the admin role.
 */
export async function ensureAdminUser(
  auth: Auth,
  db: AxleDatabase,
  adminUser: { email: string; password: string; name?: string },
): Promise<{ userId: string; created: boolean }> {
  const existing = db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.email, adminUser.email))
    .get();
  if (existing) {
    setRole(db, existing.id, "admin");
    return { userId: existing.id, created: false };
  }
  const signUp = await auth.api.signUpEmail({
    body: {
      email: adminUser.email,
      password: adminUser.password,
      name: adminUser.name ?? "admin",
    },
  });
  setRole(db, signUp.user.id, "admin");
  return { userId: signUp.user.id, created: true };
}

/** Create a user with a role (admin-only operation at the API layer). */
export async function createUser(
  auth: Auth,
  db: AxleDatabase,
  user: { email: string; password: string; name?: string; role: Role },
): Promise<string> {
  const signUp = await auth.api.signUpEmail({
    body: {
      email: user.email,
      password: user.password,
      name: user.name ?? user.email,
    },
  });
  setRole(db, signUp.user.id, user.role);
  return signUp.user.id;
}

/** Mint an API key for a known user id. */
export async function createApiKeyFor(
  auth: Auth,
  userId: string,
  name: string,
): Promise<string> {
  const created = await auth.api.createApiKey({ body: { userId, name } });
  return created.key;
}

function setRole(db: AxleDatabase, userId: string, role: Role): void {
  db.update(authSchema.user)
    .set({ role })
    .where(eq(authSchema.user.id, userId))
    .run();
}
