import fs from "node:fs";
import path from "node:path";
import { resolveConfig } from "@axle/config";

/**
 * Local storage for the CLI's API key. `axle login` writes it here (0600); every
 * command reads it as the bearer credential. `AXLE_API_KEY` overrides the file,
 * for CI or ephemeral shells.
 */
function keyFile(): string {
  return path.join(resolveConfig().home, "api-key");
}

export function readStoredKey(): string | undefined {
  try {
    return fs.readFileSync(keyFile(), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredKey(key: string): string {
  const file = keyFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, key, { mode: 0o600 });
  return file;
}

export function resolveApiKey(): string | undefined {
  return process.env.AXLE_API_KEY ?? readStoredKey();
}
