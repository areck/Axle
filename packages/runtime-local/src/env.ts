/**
 * Build the environment for a locally executed command.
 *
 * Even though LocalRuntime is not an isolation boundary, we still refuse to leak
 * the entire host environment (which may contain secrets) into executed code.
 * Only an explicit allowlist is forwarded, plus any caller-provided overrides.
 */
const ALLOWLIST = [
  "PATH",
  "HOME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "TMPDIR",
  "NODE_PATH",
  // Proxy configuration, so dependency installs work behind a proxy.
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
];

export function buildSandboxEnv(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  // Signal to tooling that it is running inside an Axle execution.
  env.AXLE_EXECUTION = "1";
  env.CI = env.CI ?? "1";
  return { ...env, ...overrides };
}
