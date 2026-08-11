import { spawn } from "node:child_process";

/**
 * OAuth 2.0 Device Authorization Grant client for `axle login`.
 *
 * The CLI can't host a browser redirect, so it uses the device flow: request a
 * code, have the human approve it in any browser (signing in passwordlessly via
 * GitHub/Google/magic link), then poll until approval and mint a long-lived
 * `axk_` API key from the resulting session. All calls hit the open
 * `/api/auth/*` surface — no API key is required to obtain one.
 */

// Must match `CLI_CLIENT_ID` in @axle/auth (the server pins the device flow to
// this first-party client id).
const CLI_CLIENT_ID = "axle-cli";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
  expiresIn: number;
}

/** Start the device flow: ask the API for a device + user code. */
export async function requestDeviceCode(api: string): Promise<DeviceCode> {
  const res = await fetch(`${api}/api/auth/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: CLI_CLIENT_ID }),
  });
  if (!res.ok) {
    throw new Error(
      `Could not start sign-in (${res.status}). Is the Axle API reachable at ${api}?`,
    );
  }
  const data = (await res.json()) as Record<string, unknown>;
  return {
    deviceCode: String(data.device_code),
    userCode: String(data.user_code),
    verificationUri: String(data.verification_uri),
    verificationUriComplete: String(
      data.verification_uri_complete ?? data.verification_uri,
    ),
    interval: Number(data.interval) || 5,
    expiresIn: Number(data.expires_in) || 900,
  };
}

/**
 * Poll the token endpoint until the user approves (then mint and return an
 * `axk_` API key), the request is denied, or it expires.
 */
export async function pollForApiKey(
  api: string,
  device: DeviceCode,
): Promise<string> {
  const deadline = Date.now() + device.expiresIn * 1000;
  let intervalMs = device.interval * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const res = await fetch(`${api}/api/auth/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: GRANT_TYPE,
        device_code: device.deviceCode,
        client_id: CLI_CLIENT_ID,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (typeof data.access_token === "string") {
      return mintApiKey(api, data.access_token);
    }
    switch (data.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        intervalMs += 5000;
        break;
      case "access_denied":
        throw new Error("Sign-in was denied.");
      case "expired_token":
        throw new Error("The sign-in request expired. Run `axle login` again.");
      default:
        if (!res.ok) {
          throw new Error(
            `Sign-in failed (${res.status})${
              data.error ? `: ${String(data.error)}` : ""
            }.`,
          );
        }
    }
  }
  throw new Error("Timed out waiting for approval. Run `axle login` again.");
}

/** Exchange an approved session token for a first-party `axk_` API key. */
async function mintApiKey(api: string, sessionToken: string): Promise<string> {
  const res = await fetch(`${api}/api/auth/api-key/create`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ name: "axle-cli" }),
  });
  if (!res.ok) {
    throw new Error(
      `Signed in, but minting an API key failed (${res.status}).`,
    );
  }
  const data = (await res.json()) as { key?: string };
  if (!data.key) throw new Error("Signed in, but no API key was returned.");
  return data.key;
}

/** Best-effort: open the approval URL in the user's browser. */
export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The printed URL is the fallback.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
