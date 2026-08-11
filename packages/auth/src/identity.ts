import crypto from "node:crypto";
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

export function roleOf(db: AxleDatabase, userId: string): Role {
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
 * Idempotently ensure a user identity exists and carries `role`, returning its
 * id. This provisions a **passwordless** user row directly — used to bootstrap
 * the first admin and to seed identities in tests. Human sign-ups instead go
 * through OAuth/magic-link, where the `adminEmails` allowlist assigns the role.
 */
export function ensureUser(
  db: AxleDatabase,
  user: { email: string; name?: string; role: Role },
): string {
  const existing = db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.email, user.email))
    .get();
  if (existing) {
    setRole(db, existing.id, user.role);
    return existing.id;
  }
  const id = crypto.randomUUID();
  const now = new Date();
  db.insert(authSchema.user)
    .values({
      id,
      email: user.email,
      name: user.name ?? user.email,
      emailVerified: true,
      role: user.role,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
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

/**
 * Provision (or reuse) an identity for `email` and mint an API key for it — the
 * headless path an operator uses to bootstrap the first admin key, and how tests
 * obtain credentials without an interactive OAuth flow.
 */
export async function mintApiKeyForEmail(
  auth: Auth,
  db: AxleDatabase,
  args: { email: string; name?: string; role?: Role },
): Promise<{ key: string; identity: Identity }> {
  const role = args.role ?? "member";
  const userId = ensureUser(db, { email: args.email, name: args.name, role });
  const key = await createApiKeyFor(
    auth,
    userId,
    args.name ?? `key:${args.email}`,
  );
  return { key, identity: { userId, role: roleOf(db, userId) } };
}

/** Set a user's role by id. */
export function setRole(db: AxleDatabase, userId: string, role: Role): void {
  db.update(authSchema.user)
    .set({ role })
    .where(eq(authSchema.user.id, userId))
    .run();
}

/**
 * Set a user's role by email (admin-only operation at the API layer). Returns
 * the user id, or null when no user has that email.
 */
export function setRoleByEmail(
  db: AxleDatabase,
  emailAddress: string,
  role: Role,
): string | null {
  const row = db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.email, emailAddress))
    .get();
  if (!row) return null;
  setRole(db, row.id, role);
  return row.id;
}
