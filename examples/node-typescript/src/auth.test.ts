import { describe, expect, it } from "vitest";
import { SESSION_TIMEOUT_MS, loginStatus } from "./auth";

describe("loginStatus", () => {
  it("returns 200 for valid credentials", () => {
    expect(loginStatus(true)).toBe(200);
  });

  it("returns 401 for invalid credentials", () => {
    expect(loginStatus(false)).toBe(401);
  });
});

describe("session", () => {
  it("expires after 15 minutes", () => {
    expect(SESSION_TIMEOUT_MS).toBe(900_000);
  });
});
