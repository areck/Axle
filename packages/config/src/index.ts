import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * Runtime selection.
 *
 * - `local`  — LocalRuntime: ephemeral temp-dir subprocess. No isolation. Dev only.
 * - `docker` — DockerRuntime: isolated container (not yet implemented in this pass).
 * - `auto`   — Docker if a daemon is reachable, otherwise Local (with a warning).
 */
export type RuntimeSelection = "local" | "docker" | "auto";

export interface AxleConfig {
  /** Host the API binds to. */
  apiHost: string;
  /** Port the API binds to. */
  apiPort: number;
  /** Base URL the CLI uses to reach the API. */
  apiUrl: string;
  /** Absolute path to the Axle home directory (holds the DB + artifacts). */
  home: string;
  /** Absolute path to the SQLite database file. */
  dbPath: string;
  /** Absolute path to the artifacts directory. */
  artifactsDir: string;
  /** Which runtime to use. */
  runtime: RuntimeSelection;
  /** Base64 32-byte key for encrypting secrets at rest (AXLE_SECRET_KEY). */
  secretKey?: string;
  /** Better Auth signing secret (BETTER_AUTH_SECRET); ≥32 chars. */
  authSecret?: string;
  /** Public base URL Better Auth advertises (BETTER_AUTH_URL); defaults to apiUrl. */
  authUrl: string;
  /**
   * Emails granted the `admin` role on first sign-in (AXLE_ADMIN_EMAILS,
   * comma-separated). Admins configure environments/secrets and manage roles.
   */
  adminEmails: string[];
  /** GitHub OAuth app credentials (AXLE_GITHUB_CLIENT_ID / _SECRET). */
  githubClientId?: string;
  githubClientSecret?: string;
  /** Google OAuth app credentials (AXLE_GOOGLE_CLIENT_ID / _SECRET). */
  googleClientId?: string;
  googleClientSecret?: string;
  /**
   * Optional URL the API POSTs `{ email, url }` to when a magic link is
   * requested (AXLE_MAGIC_LINK_WEBHOOK) — point it at your email/notification
   * service. When unset, the link is logged to the server console (dev).
   */
  magicLinkWebhook?: string;
  /** API key the CLI presents (AXLE_API_KEY). */
  apiKey?: string;
}

const DEFAULT_PORT = 8787;

function parseRuntime(value: string | undefined): RuntimeSelection {
  if (value === "local" || value === "docker" || value === "auto") return value;
  return "auto";
}

/**
 * Walk up from `startDir` to the pnpm workspace root so that all Axle processes
 * (API, worker, CLI) — regardless of the directory they were launched from —
 * agree on a single `.axle` home and therefore a single database + artifact
 * store. Falls back to `startDir` when no workspace marker is found.
 */
function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

/**
 * Resolve Axle configuration from the environment, applying sensible defaults.
 * Axle requires no configuration to run locally.
 */
export function resolveConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): AxleConfig {
  const apiHost = env.AXLE_API_HOST ?? "127.0.0.1";
  const apiPort = Number(env.AXLE_API_PORT ?? DEFAULT_PORT);
  const apiUrl = env.AXLE_API_URL ?? `http://${apiHost}:${apiPort}`;
  const rawHome = env.AXLE_HOME ?? ".axle";
  // Absolute AXLE_HOME wins; otherwise anchor the default at the workspace root
  // so the API and worker share one database and artifact store.
  const home = path.isAbsolute(rawHome)
    ? rawHome
    : path.resolve(findWorkspaceRoot(cwd), rawHome);

  return {
    apiHost,
    apiPort,
    apiUrl,
    home,
    dbPath: path.join(home, "axle.db"),
    artifactsDir: path.join(home, "artifacts"),
    runtime: parseRuntime(env.AXLE_RUNTIME),
    secretKey: env.AXLE_SECRET_KEY,
    authSecret: env.BETTER_AUTH_SECRET,
    authUrl: env.BETTER_AUTH_URL ?? apiUrl,
    adminEmails: parseList(env.AXLE_ADMIN_EMAILS),
    githubClientId: env.AXLE_GITHUB_CLIENT_ID,
    githubClientSecret: env.AXLE_GITHUB_CLIENT_SECRET,
    googleClientId: env.AXLE_GOOGLE_CLIENT_ID,
    googleClientSecret: env.AXLE_GOOGLE_CLIENT_SECRET,
    magicLinkWebhook: env.AXLE_MAGIC_LINK_WEBHOOK,
    apiKey: env.AXLE_API_KEY,
  };
}

/** Split a comma-separated env value into trimmed, non-empty entries. */
function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
