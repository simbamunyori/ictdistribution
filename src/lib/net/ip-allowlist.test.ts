import { describe, expect, it } from "vitest";
import { ipAllowed, parseAllowlist } from "./ip-allowlist";

describe("admin IP allowlist", () => {
  it("allows everyone when the list is empty", () => {
    expect(ipAllowed("8.8.8.8", [])).toBe(true);
  });

  it("matches exact addresses and IPv4 ranges", () => {
    const list = parseAllowlist("10.8.0.0/24, 196.45.12.7 ,2001:db8::1");
    expect(ipAllowed("10.8.0.42", list)).toBe(true);
    expect(ipAllowed("10.8.1.42", list)).toBe(false);
    expect(ipAllowed("196.45.12.7", list)).toBe(true);
    expect(ipAllowed("::ffff:196.45.12.7", list)).toBe(true);
    expect(ipAllowed("2001:DB8::1", list)).toBe(true);
    expect(ipAllowed("196.45.12.8", list)).toBe(false);
  });

  it("refuses when the address is unknown or malformed", () => {
    const list = parseAllowlist("10.0.0.0/8");
    expect(ipAllowed(null, list)).toBe(false);
    expect(ipAllowed("10.0.0", list)).toBe(false);
    expect(ipAllowed("10.0.0.300", list)).toBe(false);
  });
});
