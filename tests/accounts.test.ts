import { describe, expect, it } from "vitest";
import { acceptInvitation, changeRole, inviteMember, listCustomers, organisationHistory, removeMember, setOrganisationType } from "../src/server/accounts/organisations";
import { signUp } from "../src/server/accounts/sign-up";
import { priceLevelFor } from "../src/server/pricing/customer-types";
import { addMember, db, hasDb, lastSecret, makeOrganisation, makeStaff, sessionFor, testDeps, uniqueEmail } from "./helpers";

describe.skipIf(!hasDb)("customer accounts", () => {
  it("signs up an individual at the Individual price level", async () => {
    const email = uniqueEmail("person");
    const { organisationId, userId } = await signUp(testDeps(), { email, name: "Boitumelo Ntsho", country: "BW" });
    expect(organisationId).toBeNull();
    expect((await priceLevelFor(db, null)).code).toBe("INDIVIDUAL");
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.marketCode).toBe("bw");
  });

  it("signs up a business with its owner, at its own price level", async () => {
    const { organisationId, owner } = await makeOrganisation("Francistown Office Supplies", "RESELLER");
    expect(owner.role).toBe("OWNER");
    expect((await priceLevelFor(db, organisationId)).code).toBe("RESELLER");
  });

  it("checks sign-up details", async () => {
    await expect(signUp(testDeps(), { email: uniqueEmail("x"), name: "A", country: "XX" })).rejects.toThrow();
  });

  it("invites by email; only the invited address can accept", async () => {
    const deps = testDeps();
    const { owner, organisationId } = await makeOrganisation();
    const email = uniqueEmail("buyer");
    await inviteMember(deps, owner, email, "BUYER");
    const { token } = await lastSecret(email, "org.invitation");

    const other = await signUp(deps, { email: uniqueEmail("other"), name: "Wrong Person", country: "BW" });
    await expect(acceptInvitation(deps, await sessionFor(other.token), token)).rejects.toThrow();

    const invited = await signUp(deps, { email, name: "Lorato Buyer", country: "BW" });
    await acceptInvitation(deps, await sessionFor(invited.token), token);
    const m = await db.membership.findFirstOrThrow({ where: { organisationId, userId: invited.userId } });
    expect(m.role).toBe("BUYER");
    await expect(acceptInvitation(deps, await sessionFor(invited.token), token)).rejects.toThrow();
  });

  it("lets only an Owner manage the team, and always keeps an Owner", async () => {
    const deps = testDeps();
    const { owner, organisationId } = await makeOrganisation();
    const buyer = await addMember(organisationId, "BUYER");
    await expect(inviteMember(deps, buyer, uniqueEmail("x"), "VIEWER")).rejects.toThrow(/allow/i);
    await expect(removeMember(deps, owner, owner.membershipId)).rejects.toThrow(/owner/i);
    await changeRole(deps, owner, buyer.membershipId, "FINANCE");
    expect((await db.membership.findUniqueOrThrow({ where: { id: buyer.membershipId } })).role).toBe("FINANCE");
  });

  it("shows the customer every staff change to their organisation", async () => {
    const { organisationId } = await makeOrganisation("Maun Safari Lodges");
    const sales = await makeStaff("SALES");
    await setOrganisationType(db, sales, organisationId, "GOVERNMENT");
    const history = await organisationHistory(db, organisationId);
    expect(history[0]).toMatchObject({ action: "organisation.type-changed", actorKind: "STAFF", visibleToCustomer: true });
    expect((await priceLevelFor(db, organisationId)).code).toBe("GOVERNMENT");
    await expect(setOrganisationType(db, sales, organisationId, "INDIVIDUAL")).rejects.toThrow();
  });

  it("lets staff roles see customers but only Admin and Sales change them", async () => {
    const { organisationId } = await makeOrganisation();
    const logistics = await makeStaff("LOGISTICS");
    const list = await listCustomers(db, logistics, { type: "BUSINESS" });
    expect(list.organisations.some((o) => o.id === organisationId)).toBe(true);
    expect(list.individuals).toEqual([]);
    await expect(setOrganisationType(db, logistics, organisationId, "RESELLER")).rejects.toThrow(/role/);
  });
});
