import type { Readable } from "node:stream";

export interface PutArtifactInput {
  executionId: string;
  /** Logical kind, e.g. "log", "report", "build-output". */
  type: string;
  name: string;
  mimeType?: string;
  data: Buffer | string;
}

export interface StoredArtifactRef {
  storageKey: string;
  sizeBytes: number;
}

/**
 * Storage for execution evidence.
 *
 * The interface is deliberately transport-agnostic so the local filesystem
 * implementation can later be swapped for S3, GCS, or Azure Blob without
 * touching callers.
 */
export interface ArtifactStore {
  put(input: PutArtifactInput): Promise<StoredArtifactRef>;
  read(storageKey: string): Promise<Buffer>;
  createReadStream(storageKey: string): Readable;
  exists(storageKey: string): Promise<boolean>;
}
