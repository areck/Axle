import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { Encryptor } from "./secret-crypto";

describe("Encryptor", () => {
  const enc = new Encryptor(crypto.randomBytes(32));

  it("round-trips a value through a versioned envelope", () => {
    const sealed = enc.encrypt("s3cr3t-value");
    expect(sealed.startsWith("enc:v1:")).toBe(true);
    expect(sealed).not.toContain("s3cr3t-value");
    expect(enc.decrypt(sealed)).toBe("s3cr3t-value");
  });

  it("uses a fresh IV so the same value seals differently each time", () => {
    expect(enc.encrypt("x")).not.toBe(enc.encrypt("x"));
  });

  it("passes through legacy plaintext (no envelope prefix)", () => {
    expect(enc.decrypt("plain-old-value")).toBe("plain-old-value");
  });

  it("rejects decryption with the wrong key (authentication)", () => {
    const sealed = enc.encrypt("s3cr3t-value");
    const other = new Encryptor(crypto.randomBytes(32));
    expect(() => other.decrypt(sealed)).toThrow();
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => new Encryptor(crypto.randomBytes(16))).toThrow();
  });
});
