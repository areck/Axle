import { describe, expect, it } from "vitest";
import { VerifyConfigSchema } from "./verify-config";

describe("VerifyConfigSchema", () => {
  it("applies defaults for optional fields", () => {
    const parsed = VerifyConfigSchema.parse({
      steps: [{ name: "test", command: "npm test" }],
    });
    expect(parsed.profile).toBe("node-22");
    expect(parsed.steps[0]).toMatchObject({
      name: "test",
      command: "npm test",
      required: true,
      timeoutSeconds: 600,
    });
  });

  it("preserves explicit values", () => {
    const parsed = VerifyConfigSchema.parse({
      profile: "node-22-heavy",
      steps: [
        {
          name: "e2e",
          command: "pnpm e2e",
          required: false,
          timeoutSeconds: 1800,
        },
      ],
    });
    expect(parsed.profile).toBe("node-22-heavy");
    expect(parsed.steps[0]?.required).toBe(false);
    expect(parsed.steps[0]?.timeoutSeconds).toBe(1800);
  });

  it("rejects an empty step list", () => {
    expect(VerifyConfigSchema.safeParse({ steps: [] }).success).toBe(false);
  });

  it("rejects a step missing a command", () => {
    const result = VerifyConfigSchema.safeParse({
      steps: [{ name: "test" }],
    });
    expect(result.success).toBe(false);
  });
});
