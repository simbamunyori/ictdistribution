import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scopeArgs, TENANT_MODELS } from "./db";

describe("scopeArgs", () => {
  it("filters reads by organisation", () => {
    expect(scopeArgs("Membership", "findMany", { where: { active: true } }, "org1")).toEqual({
      where: { active: true, organisationId: "org1" },
    });
    expect(scopeArgs("Membership", "findMany", undefined, "org1")).toEqual({ where: { organisationId: "org1" } });
  });

  it("overrides a different organisation in a filter", () => {
    expect(scopeArgs("Invitation", "count", { where: { organisationId: "org2" } }, "org1")).toEqual({
      where: { organisationId: "org1" },
    });
  });

  it("stamps creates and refuses writes into another organisation", () => {
    expect(scopeArgs("Invitation", "create", { data: { email: "a@b.co" } }, "org1")).toEqual({
      data: { email: "a@b.co", organisationId: "org1" },
    });
    expect(scopeArgs("Invitation", "createMany", { data: [{ email: "a@b.co" }] }, "org1")).toEqual({
      data: [{ email: "a@b.co", organisationId: "org1" }],
    });
    expect(() => scopeArgs("Invitation", "create", { data: { email: "a@b.co", organisationId: "org2" } }, "org1")).toThrow();
  });

  it("refuses to move a row between organisations", () => {
    expect(() => scopeArgs("Membership", "update", { where: { id: "c" }, data: { organisationId: "org2" } }, "org1")).toThrow();
  });

  it("leaves models without an organisation alone", () => {
    const args = { where: { id: "u" } };
    expect(scopeArgs("User", "findUnique", args, "org1")).toBe(args);
  });

  it("knows every model with an organisation column", () => {
    const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
    const withOrg = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s+organisationId\s+String\s/m.test(body))
      .map(([, name]) => name)
      .filter((name) => name !== "AuditEvent");
    expect(withOrg.sort()).toEqual([...TENANT_MODELS].sort());
  });
});
