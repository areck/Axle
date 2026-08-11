import { describe, expect, it } from "vitest";
import { makeRedactor } from "./redact";

describe("makeRedactor", () => {
  it("replaces every occurrence of each secret value", () => {
    const redact = makeRedactor(["s3cr3t-value", "another-secret"]);
    expect(redact("token is s3cr3t-value here")).toBe("token is *** here");
    expect(redact("another-secret then s3cr3t-value")).toBe("*** then ***");
  });

  it("ignores very short values to avoid mangling output", () => {
    const redact = makeRedactor(["ab", ""]);
    expect(redact("ab cd ab")).toBe("ab cd ab");
  });

  it("is a no-op when there are no secrets", () => {
    const redact = makeRedactor([]);
    expect(redact("nothing to hide")).toBe("nothing to hide");
  });

  it("redacts a longer value before a shorter overlapping one", () => {
    const redact = makeRedactor(["abcd", "abcdef"]);
    // Longer first, so the result isn't left as "***ef".
    expect(redact("x abcdef y")).toBe("x *** y");
  });
});
