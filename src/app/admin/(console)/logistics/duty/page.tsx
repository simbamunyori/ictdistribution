import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { deleteDutyRuleAction, saveDutyRuleAction } from "@/app/admin/(console)/logistics-actions";
import { SpecForm, type FieldSpec } from "@/components/admin/spec-form";
import { LogisticsNav } from "@/components/logistics/logistics-nav";
import { ActionForm } from "@/components/ui/action-form";
import { Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { categoryOptions } from "@/server/catalogue/categories";
import { prisma } from "@/server/db";
import { homeCountry } from "@/server/logistics/landed";
import { listDutyRules, type DutyRuleInput } from "@/server/logistics/rules";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Duty and levies" };

export default async function Duty() {
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewLogistics")) redirect("/admin");
  const canManage = staffCan(role, "manageLogisticsRules");
  const [rules, categories, home] = await Promise.all([listDutyRules(prisma), categoryOptions(prisma), homeCountry(prisma)]);
  const options = categories.map((c) => ({ value: c.value, label: c.label }));
  const fields = (v: DutyRuleInput): FieldSpec[] => [
    { kind: "select", id: "categoryId", label: "Category", options, placeholder: "Every category without its own rule", defaultValue: v.categoryId },
    { kind: "text", id: "destinationCountry", label: "Into country", hint: "Two letters, such as BW.", defaultValue: v.destinationCountry },
    { kind: "text", id: "dutyPercent", label: "Customs duty %", inputMode: "decimal", defaultValue: v.dutyPercent },
    { kind: "text", id: "leviesPercent", label: "Other levies %", inputMode: "decimal", hint: "Charged on the same value as duty. Leave VAT out: it is claimed back.", defaultValue: v.leviesPercent },
    { kind: "text", id: "exemptOrigins", label: "Duty free from (optional)", hint: "Country codes, such as ZA NA LS SZ for the customs union.", defaultValue: v.exemptOrigins, wide: true },
    { kind: "text", id: "note", label: "Note (optional)", hint: "Such as the tariff heading it follows.", defaultValue: v.note, wide: true },
  ];
  return (
    <>
      <PageHeader title="Duty and levies" lead={`What is paid at the border on goods landed into ${home}, by category. A category without its own rule uses its parent's, then the rule for every category. Duty is charged on the cost, freight and insurance together.`} />
      <LogisticsNav current="/admin/logistics/duty" />
      <div className="flex max-w-4xl flex-col gap-6">
        {rules.length ? (
          rules.map((r) => (
            <Card key={r.id}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <h2 className="text-headline font-bold">
                  {r.category ? `${r.category.parent ? `${r.category.parent.name}, ` : ""}${r.category.name}` : "Every category"} into {r.destinationCountry}
                </h2>
                {canManage ? <ActionForm action={deleteDutyRuleAction} hidden={{ ruleId: r.id }} label="Remove" confirm="Remove this duty rule? Costs are worked out again." /> : null}
              </div>
              {r.category?.hsCode ? <p className="mb-3 text-caption text-ink-muted">Tariff code {r.category.hsCode}</p> : null}
              <SpecForm action={saveDutyRuleAction} idPrefix={`r${r.id}-`} hidden={{ ruleId: r.id }} fields={fields({ categoryId: r.categoryId ?? "", destinationCountry: r.destinationCountry, dutyPercent: String(r.dutyBps / 100), leviesPercent: String(r.leviesBps / 100), exemptOrigins: r.exemptOrigins.join(" "), note: r.note })} submitLabel="Save" variant="secondary" disabled={!canManage} />
            </Card>
          ))
        ) : (
          <Card>
            <p className="text-ink-muted">No duty rules yet, so landed costs include no duty.</p>
          </Card>
        )}
        {canManage ? (
          <Card>
            <h2 className="mb-4 text-headline font-bold">Add a rule</h2>
            <SpecForm action={saveDutyRuleAction} idPrefix="new-" fields={fields({ categoryId: "", destinationCountry: home, dutyPercent: "", leviesPercent: "", exemptOrigins: "", note: "" })} submitLabel="Add rule" />
          </Card>
        ) : (
          <p className="text-callout text-ink-muted">Only an Admin can change duty rules.</p>
        )}
      </div>
    </>
  );
}
