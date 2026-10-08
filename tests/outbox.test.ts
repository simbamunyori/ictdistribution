import { describe, expect, it } from "vitest";
import { MemoryEmailAdapter } from "../src/server/email/adapter";
import { deliverDue, queueEmail } from "../src/server/email/outbox";
import { db, hasDb, KEY, uniqueEmail } from "./helpers";

describe.skipIf(!hasDb)("email outbox", () => {
  it("sends once, then forgets the code", async () => {
    const to = uniqueEmail("mail");
    await queueEmail(db, KEY, { to, kind: "auth.code", secret: { code: "123456" } });
    const adapter = new MemoryEmailAdapter();
    const settings = { appUrl: "https://ictdistribution.africa", legalName: "ICT Distribution Africa", key: KEY };
    expect(await deliverDue(db, adapter, settings, new Date(), 50, { toAddress: to })).toBe(1);
    expect(await deliverDue(db, adapter, settings, new Date(), 50, { toAddress: to })).toBe(0);
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0].text).toContain("123456");
    expect(adapter.sent[0].text).not.toMatch(/!/);
    const row = await db.outboundEmail.findFirstOrThrow({ where: { toAddress: to } });
    expect(row.status).toBe("SENT");
    expect(JSON.stringify(row.payload)).not.toContain("sealed");
    expect(row.subject).toBe("auth.code");
  });

  it("tries again later when sending fails", async () => {
    const to = uniqueEmail("fail");
    await queueEmail(db, KEY, { to, kind: "auth.code", secret: { code: "654321" } });
    const failing = { send: async () => Promise.reject(new Error("mail server down")) };
    const now = new Date();
    await deliverDue(db, failing, { appUrl: "https://x.test", legalName: "X", key: KEY }, now, 50, { toAddress: to });
    const row = await db.outboundEmail.findFirstOrThrow({ where: { toAddress: to } });
    expect(row.status).toBe("QUEUED");
    expect(row.lastError).toBe("mail server down");
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
  });
});
