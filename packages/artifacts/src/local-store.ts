import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type {
  ArtifactStore,
  PutArtifactInput,
  StoredArtifactRef,
} from "./types";

/**
 * Filesystem-backed artifact store. Content is written under
 * `<baseDir>/<executionId>/<name>`; the storage key is the path relative to the
 * base directory.
 */
export class LocalArtifactStore implements ArtifactStore {
  constructor(private readonly baseDir: string) {}

  async put(input: PutArtifactInput): Promise<StoredArtifactRef> {
    const storageKey = `${input.executionId}/${input.name}`;
    const dest = this.resolve(storageKey);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const buffer = Buffer.isBuffer(input.data)
      ? input.data
      : Buffer.from(input.data, "utf8");
    await fs.writeFile(dest, buffer);
    return { storageKey, sizeBytes: buffer.byteLength };
  }

  async read(storageKey: string): Promise<Buffer> {
    return fs.readFile(this.resolve(storageKey));
  }

  createReadStream(storageKey: string): Readable {
    return createReadStream(this.resolve(storageKey));
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  private resolve(storageKey: string): string {
    const root = path.resolve(this.baseDir);
    const full = path.resolve(root, storageKey);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error(`Invalid artifact storage key: ${storageKey}`);
    }
    return full;
  }
}
