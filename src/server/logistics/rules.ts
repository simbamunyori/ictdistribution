import type { PrismaClient } from "@prisma/client";
import { isCountryCode } from "@/lib/countries";
import { audit, staffAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { procurementSettings } from "@/server/procurement/common";
import { refreshCosts } from "@/server/shop/costs";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";
import { logisticsSettings } from "./landed";

/**
 * The Admin's logistics rules: duty and levies by category and country,
 * the volumetric factors and insurance used in estimates, how many past
 * shipments to learn from, and whether orders use our stock or go
 * straight from the supplier to the customer.
 */

function percent(text: string, max: number, field: string, errors: Record<string, string>): number {
  const t = text.trim();
  if (!t) return 0;
  const n = /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
  if (!Number.isFinite(n) || n > max) {
    errors[field] = `Enter a percentage from 0 to ${max}.`;
    return 0;
  }
  return Math.round(n * 100);
}

// ─── Duty ────────────────────────────────────────────────────────────

export async function listDutyRules(db: Pick<PrismaClient, "dutyRule">) {
  return db.dutyRule.findMany({ orderBy: [{ destinationCountry: "asc" }, { category: { name: "asc" } }], include: { category: { select: { name: true, hsCode: true, parent: { select: { name: true } } } } } });
}

export interface DutyRuleInput {
  /** Empty for every category without its own rule. */
  categoryId: string;
  destinationCountry: string;
  dutyPercent: string;
  leviesPercent: string;
  /** Country codes goods come from duty free, such as a customs union. */
  exemptOrigins: string;
  note: string;
}

export async function saveDutyRule(db: PrismaClient, actor: StaffActor, id: string | null, input: DutyRuleInput, ip?: string | null) {
  assertStaffCan(actor, "manageLogisticsRules");
  const errors: Record<string, string> = {};
  const destinationCountry = input.destinationCountry.trim().toUpperCase();
  if (!isCountryCode(destinationCountry)) errors.destinationCountry = "Enter the two-letter country code, such as BW.";
  const dutyBps = percent(input.dutyPercent, 100, "dutyPercent", errors);
  const leviesBps = percent(input.leviesPercent, 100, "leviesPercent", errors);
  const exemptOrigins = [...new Set(input.exemptOrigins.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const bad = exemptOrigins.filter((c) => !isCountryCode(c));
  if (bad.length) errors.exemptOrigins = `${bad.join(", ")} ${bad.length === 1 ? "is not a country code" : "are not country codes"}.`;
  const note = input.note.trim();
  if (note.length > 300) errors.note = "Keep it under 300 characters.";
  const categoryId = input.categoryId.trim() || null;
  if (Object.keys(errors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, errors);
  await db.$transaction(async (tx) => {
    const category = categoryId ? await tx.category.findUnique({ where: { id: categoryId }, select: { name: true } }) : null;
    if (categoryId && !category) throw new DomainError("invalid", "Choose a category.", "categoryId");
    const clash = await tx.dutyRule.findFirst({ where: { categoryId, destinationCountry, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
    if (clash) throw new DomainError("invalid", `There is already a rule for ${category?.name ?? "every category"} into ${destinationCountry}. Change that one.`, "categoryId");
    const data = { categoryId, destinationCountry, dutyBps, leviesBps, exemptOrigins, note };
    const r = id ? await tx.dutyRule.update({ where: { id }, data }) : await tx.dutyRule.create({ data });
    await audit(tx, staffAudit(actor, { action: "duty.saved", summary: `Set duty for ${category?.name ?? "every category"} into ${destinationCountry}: ${dutyBps / 100}% duty, ${leviesBps / 100}% levies${exemptOrigins.length ? `, free from ${exemptOrigins.join(", ")}` : ""}`, targetType: "DutyRule", targetId: r.id, ipAddress: ip }));
  });
  await refreshCosts(db);
}

export async function deleteDutyRule(db: PrismaClient, actor: StaffActor, id: string, ip?: string | null) {
  assertStaffCan(actor, "manageLogisticsRules");
  await db.$transaction(async (tx) => {
    const r = await tx.dutyRule.findUnique({ where: { id }, include: { category: { select: { name: true } } } });
    if (!r) throw new DomainError("not-found", "No such rule.");
    await tx.dutyRule.delete({ where: { id } });
    await audit(tx, staffAudit(actor, { action: "duty.deleted", summary: `Removed the duty rule for ${r.category?.name ?? "every category"} into ${r.destinationCountry}`, targetType: "DutyRule", targetId: id, ipAddress: ip }));
  });
  await refreshCosts(db);
}

// ─── Settings ────────────────────────────────────────────────────────

export interface LogisticsRulesInput {
  homeCountry: string;
  airKgPerM3: string;
  courierKgPerM3: string;
  roadKgPerM3: string;
  seaKgPerM3: string;
  insurancePercent: string;
  sampleSize: string;
  incoterm: string;
  useStock: boolean;
  dropShipByDefault: boolean;
}

export async function logisticsRulesForm(db: PrismaClient): Promise<LogisticsRulesInput> {
  const [s, p] = await Promise.all([logisticsSettings(db), procurementSettings(db)]);
  return { homeCountry: s.homeCountry, airKgPerM3: String(s.airKgPerM3), courierKgPerM3: String(s.courierKgPerM3), roadKgPerM3: String(s.roadKgPerM3), seaKgPerM3: String(s.seaKgPerM3), insurancePercent: String(s.insuranceBps / 100), sampleSize: String(s.sampleSize), incoterm: s.incoterm, useStock: p.useStock, dropShipByDefault: p.dropShipByDefault };
}

export const INCOTERMS = ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"];

export async function updateLogisticsRules(db: PrismaClient, actor: StaffActor, input: LogisticsRulesInput, ip?: string | null) {
  assertStaffCan(actor, "manageLogisticsRules");
  const errors: Record<string, string> = {};
  const homeCountry = input.homeCountry.trim().toUpperCase();
  if (!isCountryCode(homeCountry)) errors.homeCountry = "Enter the two-letter country code, such as BW.";
  const factor = (field: "airKgPerM3" | "courierKgPerM3" | "roadKgPerM3" | "seaKgPerM3") => {
    const t = input[field].trim();
    const n = /^\d{1,5}$/.test(t) ? Number(t) : NaN;
    if (!(n >= 50 && n <= 5000)) errors[field] = "Enter kilograms per cubic metre, from 50 to 5000.";
    return n;
  };
  const factors = { airKgPerM3: factor("airKgPerM3"), courierKgPerM3: factor("courierKgPerM3"), roadKgPerM3: factor("roadKgPerM3"), seaKgPerM3: factor("seaKgPerM3") };
  const insuranceBps = percent(input.insurancePercent, 20, "insurancePercent", errors);
  const sampleSize = /^\d{1,3}$/.test(input.sampleSize.trim()) ? Number(input.sampleSize.trim()) : NaN;
  if (!(sampleSize >= 1 && sampleSize <= 500)) errors.sampleSize = "Enter how many shipments, from 1 to 500.";
  const incoterm = input.incoterm.trim().toUpperCase();
  if (!INCOTERMS.includes(incoterm)) errors.incoterm = "Choose an Incoterm.";
  if (Object.keys(errors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, errors);
  await db.$transaction(async (tx) => {
    await Promise.all([logisticsSettings(tx), procurementSettings(tx)]);
    await tx.logisticsSettings.update({ where: { id: "global" }, data: { homeCountry, ...factors, insuranceBps, sampleSize, incoterm } });
    await tx.procurementSettings.update({ where: { id: "global" }, data: { useStock: input.useStock, dropShipByDefault: input.dropShipByDefault } });
    await audit(tx, staffAudit(actor, { action: "logistics.rules", summary: `Changed the logistics rules: home ${homeCountry}, insurance ${insuranceBps / 100}%, learn from the last ${sampleSize} shipments per route, ${input.useStock ? "use our stock first" : "always buy"}${input.dropShipByDefault ? ", suppliers deliver straight to customers" : ""}`, targetType: "LogisticsSettings", targetId: "global", ipAddress: ip }));
  });
  await refreshCosts(db);
}
