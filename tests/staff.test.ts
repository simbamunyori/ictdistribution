import { describe, expect, it } from "vitest";
import { listAudit } from "../src/server/audit";
import { findStaffInvitation, acceptStaffInvitation, changeStaffRole, inviteStaff, revokeStaffInvitation, setStaffActive } from "../src/server/staff/staff";
import { db, hasDb, lastSecret, makeStaff, sessionFor, testDeps, uniqueEmail } from "./helpers";

describe.skipIf(!hasDb)("staff accounts", () => {
  it("invites the first Admin from the server, who then must add a passkey", async () => {
    const email = uniqueEmail("first-admin");
    const { token } = await inviteStaff(testDeps(), null, { name: "Simba Admin", email, role: "ADMIN" });
    expect((await lastSecret(email, "staff.invitation")).token).toBe(token);
    expect(await findStaffInvitation(db, token)).not.toBeNull();
    const session = await acceptStaffInvitation(testDeps(), token);
    const s = await sessionFor(session.token, "STAFF");
    expect(s.stage).toBe("PASSKEY_SETUP");
    expect(s.user.staffRole).toBe("ADMIN");
    await expect(acceptStaffInvitation(testDeps(), token)).rejects.toThrow(/expired|used/);
    const [event] = await listAudit(db, { action: "staff.invited" }, 50).then((rows) => rows.filter((r) => r.summary.includes(email)));
    expect(event.actorLabel).toBe("Server command");
  });

  it("lets only an Admin invite, and withdrawn invitations stop working", async () => {
    const admin = await makeStaff("ADMIN");
    const finance = await makeStaff("FINANCE");
    await expect(inviteStaff(testDeps(), finance, { name: "New Person", email: uniqueEmail("n"), role: "SALES" })).rejects.toThrow(/role/);
    const { token } = await inviteStaff(testDeps(), admin, { name: "New Person", email: uniqueEmail("n"), role: "SALES" });
    const inv = await findStaffInvitation(db, token);
    await revokeStaffInvitation(db, admin, inv!.id);
    expect(await findStaffInvitation(db, token)).toBeNull();
  });

  it("refuses a customer's address", async () => {
    const admin = await makeStaff("ADMIN");
    const customer = await db.user.create({ data: { email: uniqueEmail("customer"), name: "A Customer" } });
    await expect(inviteStaff(testDeps(), admin, { name: "A Customer", email: customer.email, role: "SALES" })).rejects.toThrow(/customer account/);
  });

  it("always keeps an active Admin", async () => {
    await db.user.updateMany({ where: { kind: "STAFF", staffRole: "ADMIN" }, data: { staffRole: "SUPPORT" } });
    const admin = await makeStaff("ADMIN");
    const other = await makeStaff("ADMIN");
    await changeStaffRole(db, admin, other.userId, "SALES");
    await expect(changeStaffRole(db, admin, admin.userId, "SALES")).rejects.toThrow(/always be an Admin/);
    await expect(setStaffActive(db, admin, admin.userId, false)).rejects.toThrow(/own account/);
    const sales = await makeStaff("SALES");
    await expect(changeStaffRole(db, sales, admin.userId, "SUPPORT")).rejects.toThrow(/role/);
  });
});
