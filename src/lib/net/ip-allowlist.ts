/**
 * Matches an address against a list of exact addresses and IPv4 ranges
 * ("196.45.0.0/16"). Used to keep /admin to the office and the VPN when ADMIN_IP_ALLOWLIST is set.
 * Pure functions, so the proxy (src/proxy.ts) can use them.
 */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** "::ffff:10.0.0.1" is the IPv4 address 10.0.0.1. */
function normalise(ip: string): string {
  const s = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  return mapped ? mapped[1] : s;
}

export function parseAllowlist(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ipAllowed(ip: string | null | undefined, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!ip) return false;
  const addr = normalise(ip);
  for (const entry of allowlist) {
    const [base, bitsRaw] = entry.split("/");
    if (bitsRaw === undefined) {
      if (normalise(base) === addr) return true;
      continue;
    }
    const bits = Number(bitsRaw);
    const a = ipv4ToInt(addr);
    const b = ipv4ToInt(normalise(base));
    if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    if (bits === 0) return true;
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    if (((a & mask) >>> 0) === ((b & mask) >>> 0)) return true;
  }
  return false;
}
