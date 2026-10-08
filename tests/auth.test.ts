import { describe, expect, it } from "vitest";
import { requestEmailCode, signInWithEmailCode, stepUpFresh, verifyEmailCode } from "../src/server/auth/service";
import { signInWithProfile } from "../src/server/auth/identities";
import { signUp } from "../src/server/accounts/sign-up";
import { setStaffActive } from "../src/server/staff/staff";
import { db, hasDb, lastSecret, makeStaff, sessionFor, testDeps, uniqueEmail } from "./helpers";

describe.skipIf(!hasDb)("email codes", () => {
  it("signs in an existing customer and sends someone new to sign up", async () => {
    const deps = testDeps();
    const email = uniqueEmail("new");
    await requestEmailCode(deps, email, "CUSTOMER");
    const { code } = await lastSecret(email, "auth.code");
    expect(code).toMatch(/^\d{6}$/);
    const first = await signInWithEmailCode(deps, email, code, "CUSTOMER");
    expect(first).toEqual({ kind: "sign-up", email });

    await signUp(deps, { email, name: "Kagiso Molefe", country: "BW" });
    await requestEmailCode(deps, email, "CUSTOMER");
    const again = await signInWithEmailCode(deps, email, (await lastSecret(email, "auth.code")).code, "CUSTOMER");
    expect(again.kind).toBe("session");
    if (again.kind === "session") {
      expect(again.stage).toBe("ACTIVE");
      expect(stepUpFresh(await sessionFor(again.token))).toBe(true);
    }
  });

  it("works once, and stops after five wrong tries", async () => {
    const deps = testDeps();
    const email = uniqueEmail("tries");
    await requestEmailCode(deps, email, "CUSTOMER");
    const { code } = await lastSecret(email, "auth.code");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) await expect(verifyEmailCode(deps, email, "CUSTOMER", wrong)).rejects.toThrow(/didn't work/);
    await expect(verifyEmailCode(deps, email, "CUSTOMER", wrong)).rejects.toThrow(/stopped working/);
    await expect(verifyEmailCode(deps, email, "CUSTOMER", code)).rejects.toThrow(/expired/);

    await requestEmailCode(deps, email, "CUSTOMER");
    const fresh = (await lastSecret(email, "auth.code")).code;
    await expect(verifyEmailCode(deps, email, "CUSTOMER", fresh)).resolves.toBe(email);
    await expect(verifyEmailCode(deps, email, "CUSTOMER", fresh)).rejects.toThrow();
  });

  it("expires after ten minutes", async () => {
    const start = Date.now();
    const email = uniqueEmail("late");
    await requestEmailCode(testDeps(() => new Date(start)), email, "CUSTOMER");
    const { code } = await lastSecret(email, "auth.code");
    await expect(verifyEmailCode(testDeps(() => new Date(start + 11 * 60_000)), email, "CUSTOMER", code)).rejects.toThrow(/expired/);
  });

  it("sends staff codes only to active staff, and starts staff at the passkey step", async () => {
    const deps = testDeps();
    const stranger = uniqueEmail("not-staff");
    await requestEmailCode(deps, stranger, "STAFF");
    expect(await db.outboundEmail.count({ where: { toAddress: stranger } })).toBe(0);

    const staff = await makeStaff("SALES");
    await requestEmailCode(deps, staff.email, "STAFF");
    const outcome = await signInWithEmailCode(deps, staff.email, (await lastSecret(staff.email, "staff.code")).code, "STAFF");
    expect(outcome.kind === "session" && outcome.stage).toBe("PASSKEY_SETUP");
    await db.passkey.create({ data: { userId: staff.userId, credentialId: `cred-${staff.userId}`, publicKey: Buffer.from("x"), counter: 0, name: "Test" } });
    await requestEmailCode(deps, staff.email, "STAFF");
    const second = await signInWithEmailCode(deps, staff.email, (await lastSecret(staff.email, "staff.code")).code, "STAFF");
    expect(second.kind === "session" && second.stage).toBe("PASSKEY_PENDING");
  });

  it("keeps customers and staff apart", async () => {
    const deps = testDeps();
    const staff = await makeStaff("SUPPORT");
    await requestEmailCode(deps, staff.email, "CUSTOMER");
    await expect(signInWithEmailCode(deps, staff.email, (await lastSecret(staff.email, "auth.code")).code, "CUSTOMER")).rejects.toThrow(/staff address/);
  });

  it("ends a staff member's sessions when they are switched off", async () => {
    const deps = testDeps();
    const admin = await makeStaff("ADMIN");
    const staff = await makeStaff("LOGISTICS");
    await requestEmailCode(deps, staff.email, "STAFF");
    const outcome = await signInWithEmailCode(deps, staff.email, (await lastSecret(staff.email, "staff.code")).code, "STAFF");
    if (outcome.kind !== "session") throw new Error("expected a session");
    await setStaffActive(db, admin, staff.userId, false);
    await expect(sessionFor(outcome.token, "STAFF")).rejects.toThrow();
    const before = await db.outboundEmail.count({ where: { toAddress: staff.email } });
    await requestEmailCode(deps, staff.email, "STAFF");
    expect(await db.outboundEmail.count({ where: { toAddress: staff.email } })).toBe(before);
  });
});

describe.skipIf(!hasDb)("Microsoft and Google", () => {
  const profile = (email: string, subject = `sub-${email}`) => ({ provider: "GOOGLE" as const, subject, email, emailVerified: true, name: "Thato Sello" });

  it("asks for an emailed code before linking to an existing account", async () => {
    const deps = testDeps();
    const email = uniqueEmail("existing");
    await signUp(deps, { email, name: "Thato Sello", country: "ZA" });
    expect(await signInWithProfile(deps, profile(email), "CUSTOMER")).toEqual({ kind: "confirm-link", email });
  });

  it("refuses unverified email and staff outside the staff door", async () => {
    const deps = testDeps();
    expect(await signInWithProfile(deps, { ...profile(uniqueEmail("u")), emailVerified: false }, "CUSTOMER")).toEqual({ kind: "refused", reason: "unverified" });
    expect(await signInWithProfile(deps, { ...profile(uniqueEmail("s")), provider: "MICROSOFT" }, "STAFF")).toEqual({ kind: "refused", reason: "unknown-staff" });
  });
});
