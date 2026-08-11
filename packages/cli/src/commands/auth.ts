import { AxleClient } from "../client";
import {
  type DeviceCode,
  openBrowser,
  pollForApiKey,
  requestDeviceCode,
} from "../device-auth";
import { clearStoredKey, writeStoredKey } from "../keystore";
import { fail, field, heading } from "../ui";

export interface LoginOptions {
  api: string;
  json: boolean;
}

/**
 * Sign in with the OAuth device flow: request a code, point the user at the
 * approval page, poll until approved, then store the minted API key.
 */
export async function loginCommand(options: LoginOptions): Promise<void> {
  const client = new AxleClient(options.api);
  if (!(await client.health())) {
    fail(`Cannot reach the Axle API at ${options.api}.`);
  }

  const device = await requestDeviceCode(options.api);
  printApproval(device, options.json);
  if (!options.json) openBrowser(device.verificationUriComplete);

  const key = await pollForApiKey(options.api, device);
  const file = writeStoredKey(key);

  // Resolve the identity behind the new key for a friendly confirmation.
  const identity = await new AxleClient(options.api, key).whoami();

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ role: identity?.role, keyStored: file })}\n`,
    );
    return;
  }
  heading("Signed in");
  if (identity) field("Role", identity.role);
  field("Key stored", file);
  process.stdout.write("\n");
}

function printApproval(device: DeviceCode, json: boolean): void {
  if (json) {
    process.stdout.write(
      `${JSON.stringify({
        userCode: device.userCode,
        verificationUri: device.verificationUri,
        verificationUriComplete: device.verificationUriComplete,
      })}\n`,
    );
    return;
  }
  heading("Authorize Axle CLI");
  field("Open", device.verificationUriComplete);
  field("Your code", device.userCode);
  process.stdout.write("\nWaiting for approval…\n");
}

/** Forget the stored API key. */
export async function logoutCommand(options: {
  json: boolean;
}): Promise<void> {
  const removed = clearStoredKey();
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ loggedOut: removed })}\n`);
    return;
  }
  heading("Logout");
  field("Status", removed ? "signed out" : "no stored key");
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

export interface SetRoleOptions {
  api: string;
  email: string;
  role: string;
  json: boolean;
}

/** Admin-only: promote or demote another user by email. */
export async function setRoleCommand(options: SetRoleOptions): Promise<void> {
  const client = new AxleClient(options.api);
  const result = await client.setRole(options.email, options.role);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  heading("Role updated");
  field("Email", options.email);
  field("Role", result.role);
  process.stdout.write("\n");
}
