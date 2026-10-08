import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { deleteOverrideAction, saveOverrideAction } from "@/app/admin/(console)/logistics-actions";
import { SpecForm } from "@/components/admin/spec-form";
import { LogisticsNav } from "@/components/logistics/logistics-nav";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { company } from "@/config/app";
import { cn } from "@/lib/cn";
import { SHIP_MODE_LABEL } from "@/lib/freight";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { estimateConsignment, routeEstimates, SHIP_MODES } from "@/server/logistics/shipments";
import { staffCan } from "@/server/staff/access";

export const metadata: Metadata = { title: "Freight estimates" };

const MODE_OPTIONS = SHIP_MODES.map((m) => ({ value: m, label: SHIP_MODE_LABEL[m] }));

export default async function Estimates({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireStaff();
  const role = { staffRole: session.user.staffRole };
  if (!staffCan(role, "viewLogistics")) redirect("/admin");
  const canManage = staffCan(role, "manageShipments");
  const { base, home, settings, routes, overrides } = await routeEstimates(prisma);
  const money = (n: bigint) => formatMoney({ amountMinor: n, currency: base }, company.staffLocale);
  const calc = { originCountry: q.origin ?? "", mode: q.mode ?? "ROAD", weightKg: q.kg ?? "", volumeM3: q.m3 ?? "", goodsValue: q.value ?? "" };
  let result: Awaited<ReturnType<typeof estimateConsignment>> | null = null;
  let calcErrors: Record<string, string> = {};
  if (q.origin || q.kg) {
    try {
      result = await estimateConsignment(prisma, calc);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      calcErrors = e.fieldErrors ?? {};
    }
  }
  return (
    <>
      <PageHeader title="Freight estimates" lead={`What it typically costs to bring goods into ${home}, per chargeable kilogram, from the last ${settings.sampleSize} arrived shipments on each route. Landed costs and supplier choice use these. Set your own figure where the history is thin or out of date.`} />
      <LogisticsNav current="/admin/logistics/estimates" />
      <div className="flex max-w-5xl flex-col gap-6">
        <Card>
          <h2 className="text-headline font-bold">Routes into {home}</h2>
          {routes.length ? (
            <TableWrap label="Freight estimates by route">
              <table className="mt-3 w-full min-w-[46rem] text-callout">
                <thead>
                  <tr>
                    <th className={th}>Route</th>
                    <th className={cn(th, "text-right")}>Freight per kg</th>
                    <th className={cn(th, "text-right")}>Fees per kg</th>
                    <th className={cn(th, "text-right")}>Insurance</th>
                    <th className={cn(th, "text-right")}>Days</th>
                    <th className={th}>From</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((r) => (
                    <tr key={`${r.origin}:${r.mode}`}>
                      <td className={td}>
                        {SHIP_MODE_LABEL[r.mode]} from {r.origin}
                      </td>
                      <td className={cn(td, "text-right tabular-nums")}>{money(r.perKg)}</td>
                      <td className={cn(td, "text-right tabular-nums")}>{money(r.feesPerKg)}</td>
                      <td className={cn(td, "text-right tabular-nums")}>{((r.insuranceBps ?? settings.insuranceBps) / 100).toLocaleString(company.staffLocale)}%</td>
                      <td className={cn(td, "text-right tabular-nums")}>{r.transitDays ?? "Not known"}</td>
                      <td className={td}>
                        {r.samples ? `${r.samples} ${r.samples === 1 ? "shipment" : "shipments"}` : "Your figure only"}
                        {r.overridden ? (
                          <span className="ml-2">
                            <Badge tone="highlight">Your figure</Badge>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="mt-2 text-callout text-ink-muted">No estimates yet. Record or load past shipments, or set a figure below. Until then, each supplier&apos;s landed cost allowance is used.</p>
          )}
          <p className="mt-3 text-caption text-ink-muted">Chargeable weight is the gross weight or the volumetric weight, whichever is more. Fees are clearing and other costs. Insurance is on the value of the goods.</p>
        </Card>

        {overrides.length ? (
          <Card>
            <h2 className="text-headline font-bold">Your figures</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {overrides.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 text-callout">
                  <span>
                    <span className="font-semibold">
                      {SHIP_MODE_LABEL[o.mode]} from {o.originCountry}:
                    </span>{" "}
                    {[o.perKgMinor !== null ? `freight ${money(o.perKgMinor)} a kg` : "", o.feesPerKgMinor !== null ? `fees ${money(o.feesPerKgMinor)} a kg` : "", o.transitDays !== null ? `${o.transitDays} days` : ""].filter(Boolean).join(", ")}
                    <span className="block text-caption text-ink-muted">
                      {o.note ? `${o.note}. ` : ""}Set by {o.updatedByLabel}
                    </span>
                  </span>
                  {canManage ? <ActionForm action={deleteOverrideAction} hidden={{ overrideId: o.id }} label="Use history instead" /> : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {canManage ? (
          <Card>
            <h2 className="text-headline font-bold">Set your own figure</h2>
            <p className="mt-1 mb-4 text-callout text-ink-muted">For a route with no history, or when rates have changed. Leave a field empty to keep the figure from history. Costs are worked out again when you save.</p>
            <SpecForm
              action={saveOverrideAction}
              columns={3}
              fields={[
                { kind: "text", id: "originCountry", label: "From country", hint: "Two letters, such as CN." },
                { kind: "select", id: "mode", label: "Mode", options: MODE_OPTIONS, defaultValue: "ROAD" },
                { kind: "text", id: "transitDays", label: "Days in transit", inputMode: "numeric" },
                { kind: "text", id: "perKg", label: `Freight per kg (${base})`, inputMode: "decimal" },
                { kind: "text", id: "feesPerKg", label: `Fees per kg (${base})`, inputMode: "decimal" },
                { kind: "text", id: "note", label: "Why (optional)", hint: "Such as the forwarder's new rate card." },
              ]}
              submitLabel="Save figure"
              pendingLabel="Saving"
            />
          </Card>
        ) : null}

        <Card>
          <h2 className="text-headline font-bold">Estimate a consignment</h2>
          <p className="mt-1 mb-4 text-callout text-ink-muted">What bringing goods in should cost, before duty. Staff can always agree a different price with the forwarder.</p>
          <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            {[
              { id: "origin", label: "From country", value: calc.originCountry, err: calcErrors.originCountry },
              { id: "kg", label: "Weight (kg)", value: calc.weightKg, err: calcErrors.weightKg },
              { id: "m3", label: "Volume (cubic metres)", value: calc.volumeM3, err: calcErrors.volumeM3 },
              { id: "value", label: `Goods value (${base})`, value: calc.goodsValue, err: calcErrors.goodsValue },
            ].map((f) => (
              <label key={f.id} className="flex flex-col gap-1.5">
                <span className="text-callout font-semibold">{f.label}</span>
                <input name={f.id} defaultValue={f.value} aria-invalid={f.err ? true : undefined} className={inputClass} inputMode={f.id === "origin" ? undefined : "decimal"} />
              </label>
            ))}
            <label className="flex flex-col gap-1.5">
              <span className="text-callout font-semibold">Mode</span>
              <select name="mode" defaultValue={calc.mode} className={cn(inputClass, "pr-8")}>
                {MODE_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-full">
              <button type="submit" className="h-11 rounded-md border border-line bg-raised px-4 font-semibold hover:bg-surface">
                Estimate
              </button>
            </div>
          </form>
          {Object.keys(calcErrors).length ? <Alert className="mt-4">{Object.values(calcErrors).join(" ")}</Alert> : null}
          {result && !result.route ? <Alert tone="warning" className="mt-4">There is no estimate for that route yet.</Alert> : null}
          {result?.route ? (
            <dl className="mt-4 grid gap-x-6 gap-y-2 text-callout sm:grid-cols-3" aria-live="polite">
              <div>
                <dt className="text-ink-muted">Chargeable weight</dt>
                <dd className="font-semibold tabular-nums">{(result.chargeableGrams! / 1000).toLocaleString(company.staffLocale)} kg</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Freight</dt>
                <dd className="font-semibold tabular-nums">{money(result.freight!)}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Clearing and fees</dt>
                <dd className="font-semibold tabular-nums">{money(result.fees!)}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Insurance</dt>
                <dd className="font-semibold tabular-nums">{money(result.insurance!)}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Before duty</dt>
                <dd className="font-semibold tabular-nums">{money(result.total!)}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Typical time</dt>
                <dd className="font-semibold">{result.route.transitDays !== null ? `${result.route.transitDays} days` : "Not known"}</dd>
              </div>
            </dl>
          ) : null}
        </Card>
      </div>
    </>
  );
}
