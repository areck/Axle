import { AxleClient } from "../client";
import { writeStoredKey } from "../keystore";
import { fail, field, heading } from "../ui";

export interface LoginOptions {
  api: string;
  email: string;
  password: string;
  json: boolean;
}

/** Exchange email/password for an API key and store it for future commands. */
export async function loginCommand(options: LoginOptions): Promise<void> {
  const client = new AxleClient(options.api);
  const { key, role } = await client.login(options.email, options.password);
  const file = writeStoredKey(key);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ role, keyStored: file })}\n`);
    return;
  }
  heading("Login");
  field("Signed in", options.email);
  field("Role", role);
  field("Key stored", file);
  process.stdout.write("\n");
}

export async function whoamiCommand(options: {
  api: string;
  json: boolean;
}): Promise<void> {
  const client = new AxleClient(options.api);
  const identity = await client.whoami();
  if (options.json) {
    process.stdout.write(`${JSON.stringify(identity)}\n`);
    return;
  }
  if (!identity) fail("Not authenticated. Run `axle login`.");
  heading("Identity");
  field("User", identity.userId);
  field("Role", identity.role);
  process.stdout.write("\n");
}

export interface CreateUserOptions {
  api: string;
  email: string;
  password: string;
  role: string;
  json: boolean;
}

/** Admin-only: provision another user (member or admin). */
export async function createUserCommand(
  options: CreateUserOptions,
): Promise<void> {
  const client = new AxleClient(options.api);
  const result = await client.createUser({
    email: options.email,
    password: options.password,
    role: options.role,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  heading("User created");
  field("Email", options.email);
  field("Role", result.role);
  process.stdout.write("\n");
}
