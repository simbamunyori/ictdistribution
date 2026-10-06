import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { open, seal } from "./secret-box";

const key = randomBytes(32).toString("base64");

describe("secret box", () => {
  it("round-trips and never repeats ciphertext", () => {
    const a = seal("JBSWY3DPEHPK3PXP", key);
    expect(open(a, key)).toBe("JBSWY3DPEHPK3PXP");
    expect(seal("JBSWY3DPEHPK3PXP", key)).not.toBe(a);
    expect(a).not.toContain("JBSW");
  });

  it("refuses the wrong key or a tampered value", () => {
    const a = seal("secret", key);
    expect(() => open(a, randomBytes(32).toString("base64"))).toThrow();
    const parts = a.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => open(parts.join("."), key)).toThrow();
  });

  it("refuses a key of the wrong size", () => {
    expect(() => seal("x", Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
