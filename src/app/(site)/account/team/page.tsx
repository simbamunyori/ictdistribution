import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InviteForm } from "@/components/account/forms";
import { Alert } from "@/components/ui/alert";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { actorFor, listMembers, organisationHistory } from "@/server/accounts/organisations";
import { requireCustomer } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { currentMarket } from "@/server/markets/current";
import { can, ORG_ROLE_DESCRIPTION, ORG_ROLE_LABEL, ORG_ROLES } from "@/server/org/access";
import { memberAction } from "../actions";

export const metadata: Metadata = { title: "Team" };

export default async function Team({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await requireCustomer("/account/team");
  const actor = await actorFor(prisma, session);
  if (!actor) redirect("/account");
  const [org, { members, invitations }, history, { market }] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: actor.organisationId }, include: { type: true } }),
    listMembers(prisma, actor.organisationId),
    organisationHistory(prisma, actor.organisationId, 25),
    currentMarket(),
  ]);
  const manage = can(actor, "manageTeam");
  const roles = ORG_ROLES.map((r) => ({ value: r, label: ORG_ROLE_LABEL[r] }));
  const dates = new Intl.DateTimeFormat(market.locale, { dateStyle: "medium", timeStyle: "short", timeZone: market.timeZone });

  return (
    <>
      <PageHeader title={org.name} lead={`${org.type.name} account. You are ${ORG_ROLE_LABEL[actor.role]}.`} />
      {q.created ? <Alert tone="positive" className="mb-6">{org.name} is set up. Invite your colleagues below. Our team will check the business before trade prices show.</Alert> : null}
      {q.joined ? <Alert tone="positive" className="mb-6">You&apos;ve joined {org.name}.</Alert> : null}

      <div className="grid gap-6">
        <Card>
          <h2 className="text-headline font-bold">People</h2>
          <ul className="mt-3 divide-y divide-line">
            {members.map((m) => (
              <li key={m.id} className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
                <span>
                  <span className="block font-semibold text-ink">
                    {m.user.name} {m.id === actor.membershipId ? <Badge>You</Badge> : null}
                  </span>
                  <span className="text-callout text-ink-muted">{m.user.email}</span>
                </span>
                {manage ? (
                  <div className="flex flex-wrap items-start gap-2">
                    <ActionForm action={memberAction} hidden={{ op: "role", membershipId: m.id }} label="Change">
                      <label className="sr-only" htmlFor={`role-${m.id}`}>
                        Role for {m.user.name}
                      </label>
                      <select id={`role-${m.id}`} name="role" defaultValue={m.role} className="h-9 rounded-md border border-line bg-raised px-2 text-callout text-ink">
                        {roles.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </ActionForm>
                    <ActionForm action={memberAction} hidden={{ op: "remove", membershipId: m.id }} label={m.id === actor.membershipId ? "Leave" : "Remove"} variant="destructive" confirm={m.id === actor.membershipId ? "Leave this organisation?" : `Remove ${m.user.name}?`} />
                  </div>
                ) : (
                  <span className="flex items-center gap-2">
                    <Badge>{ORG_ROLE_LABEL[m.role]}</Badge>
                    {m.id === actor.membershipId ? <ActionForm action={memberAction} hidden={{ op: "remove", membershipId: m.id }} label="Leave" variant="destructive" confirm="Leave this organisation?" /> : null}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>

        {manage ? (
          <Card>
            <h2 className="text-headline font-bold">Invite someone</h2>
            <dl className="mt-2 grid gap-1 text-callout text-ink-muted sm:grid-cols-2">
              {ORG_ROLES.map((r) => (
                <div key={r}>
                  <dt className="inline font-semibold text-ink">{ORG_ROLE_LABEL[r]}: </dt>
                  <dd className="inline">{ORG_ROLE_DESCRIPTION[r]}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4">
              <InviteForm roles={roles} />
            </div>
            {invitations.length ? (
              <>
                <h3 className="mt-6 font-bold">Waiting to accept</h3>
                <ul className="mt-2 divide-y divide-line">
                  {invitations.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <span>
                        {i.email} <span className="text-ink-muted">as {ORG_ROLE_LABEL[i.role]}</span>
                      </span>
                      <ActionForm action={memberAction} hidden={{ op: "revoke", invitationId: i.id }} label="Withdraw" variant="ghost" />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Card>
        ) : null}

        <Card>
          <h2 className="text-headline font-bold">History</h2>
          <p className="mt-1 text-callout text-ink-muted">Every change to this account, including any our staff make.</p>
          <ul className="mt-3 divide-y divide-line">
            {history.map((e) => (
              <li key={e.id} className="py-2.5">
                <p className="text-ink">
                  {e.summary}
                  {e.actorKind === "STAFF" ? <span className="text-ink-muted"> (our staff)</span> : null}
                </p>
                <p className="text-caption text-ink-muted">
                  {e.actorLabel}, {dates.format(e.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
