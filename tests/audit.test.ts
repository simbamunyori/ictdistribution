import { describe, expect, it } from "vitest";
import { audit } from "../src/server/audit";
import { db, hasDb } from "./helpers";

describe.skipIf(!hasDb)("audit log", () => {
  it("can be added to but never changed or removed", async () => {
    await audit(db, { actorKind: "SYSTEM", actorLabel: "Test", action: "test.event", summary: "A test event" });
    const row = await db.auditEvent.findFirstOrThrow({ where: { action: "test.event" } });
    await expect(db.auditEvent.update({ where: { id: row.id }, data: { summary: "Changed" } })).rejects.toThrow(/never changed or removed/);
    await expect(db.auditEvent.delete({ where: { id: row.id } })).rejects.toThrow(/never changed or removed/);
    expect((await db.auditEvent.findUniqueOrThrow({ where: { id: row.id } })).summary).toBe("A test event");
  });
});
