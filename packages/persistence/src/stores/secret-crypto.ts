import crypto from "node:crypto";

/**
 * Authenticated encryption for secret values at rest.
 *
 * AES-256-GCM gives confidentiality plus tamper-detection (the auth tag). Each
 * value is sealed with a fresh random IV into a versioned, base64 envelope:
 *
 *     enc:v1:<base64( iv[12] ‖ authTag[16] ‖ ciphertext )>
 *
 * The `enc:v1:` prefix lets {@link decrypt} distinguish sealed values from
 * legacy plaintext and leaves room to rotate the scheme. The key never touches
 * the database; lose it and the secrets are unrecoverable, by design.
 */
const ALGORITHM = "aes-256-gcm";
const ENVELOPE_PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class Encryptor {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) {
      throw new Error(
        "AXLE_SECRET_KEY must decode to 32 bytes (e.g. `openssl rand -base64 32`).",
      );
    }
    this.key = key;
  }

  /** Build from a base64-encoded 32-byte key (as AXLE_SECRET_KEY carries it). */
  static fromBase64(value: string): Encryptor {
    return new Encryptor(Buffer.from(value, "base64"));
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return (
      ENVELOPE_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64")
    );
  }

  /** Decrypt a sealed value; a value without the envelope prefix is returned
   * unchanged (legacy plaintext written before encryption was introduced). */
  decrypt(stored: string): string {
    if (!stored.startsWith(ENVELOPE_PREFIX)) return stored;
    const raw = Buffer.from(stored.slice(ENVELOPE_PREFIX.length), "base64");
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  }
}
