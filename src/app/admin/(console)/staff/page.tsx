import type { Metadata } from "next";
import { staffMemberAction } from "@/app/admin/(console)/actions";
import { InviteStaffForm } from "@/components/admin/forms";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, Card, PageHeader, TableWrap, td, th } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { requireStaff } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { STAFF_PERMISSIONS, STAFF_ROLE_DESCRIPTION, STAFF_ROLE_LABEL, STAFF_ROLES, staffCan, type StaffPermission } from "@/server/staff/access";
import { listStaff } from "@/server/staff/staff";

export const metadata: Metadata = { title: "Staff" };

const roleOptions = STAFF_ROLES.map((r) => ({ value: r, label: STAFF_ROLE_LABEL[r] }));

export default async function Staff() {
  const session = await requireStaff();
  const canManage = staffCan({ staffRole: session.user.staffRole }, "manageStaff");
  const { people, invitations } = await listStaff(prisma);

  return (
    <>
      <PageHeader title="Staff" lead="Everyone signs in with a passkey. A role decides what each person can see and change." />

      {canManage ? (
        <Card className="mb-6">
          <h2 className="mb-4 text-headline font-bold">Invite a colleague</h2>
          <InviteStaffForm roles={roleOptions} />
        </Card>
      ) : null}

      <Card className="mb-6">
        <h2 className="text-headline font-bold">People</h2>
        <ul className="mt-2 divide-y divide-line">
          {people.map((p) => (
            <li key={p.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
              <span>
                <span className="block font-semibold text-ink">
                  {p.name}
                  {p.id === session.userId ? <span className="font-normal text-ink-muted"> (you)</span> : null}
                </span>
                <span className="block text-callout break-all text-ink-muted">{p.email}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {p.deactivatedAt ? <Badge tone="negative">Switched off</Badge> : <Badge tone="positive">{p.staffRole ? STAFF_ROLE_LABEL[p.staffRole] : ""}</Badge>}
                  {!p._count.passkeys && !p.deactivatedAt ? <Badge tone="warning">No passkey yet</Badge> : null}
                </span>
              </span>
              {canManage && p.id !== session.userId ? (
                <span className="flex flex-wrap items-start gap-2">
                  {!p.deactivatedAt ? (
                    <ActionForm action={staffMemberAction} hidden={{ op: "role", userId: p.id }} label="Change role">
                      <label className="sr-only" htmlFor={`role-${p.id}`}>
                        Role for {p.name}
                      </label>
                      <select id={`role-${p.id}`} name="role" defaultValue={p.staffRole ?? "SUPPORT"} className={cn(inputClass, "h-9 w-auto pr-8")}>
                        {roleOptions.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </ActionForm>
                  ) : null}
                  <ActionForm
                    action={staffMemberAction}
                    hidden={{ op: p.deactivatedAt ? "on" : "off", userId: p.id }}
                    label={p.deactivatedAt ? "Switch on" : "Switch off"}
                    variant={p.deactivatedAt ? "secondary" : "destructive"}
                    confirm={p.deactivatedAt ? undefined : `Switch off ${p.name}'s account? They are signed out everywhere at once.`}
                  />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {invitations.length ? (
        <Card className="mb-6">
          <h2 className="text-headline font-bold">Waiting to join</h2>
          <ul className="mt-2 divide-y divide-line">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  <span className="block font-semibold text-ink">
                    {i.name} <span className="font-normal text-ink-muted">as {STAFF_ROLE_LABEL[i.staffRole]}</span>
                  </span>
                  <span className="text-callout break-all text-ink-muted">
                    {i.email}, link works until {i.expiresAt.toISOString().slice(0, 10)}
                  </span>
                </span>
                {canManage ? <ActionForm action={staffMemberAction} hidden={{ op: "withdraw", invitationId: i.id }} label="Withdraw" variant="ghost" /> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-headline font-bold">What each role can do</h2>
        <ul className="mt-3 grid gap-2 text-callout md:grid-cols-2">
          {STAFF_ROLES.map((r) => (
            <li key={r}>
              <span className="font-semibold text-ink">{STAFF_ROLE_LABEL[r]}:</span> <span className="text-ink-muted">{STAFF_ROLE_DESCRIPTION[r]}</span>
            </li>
          ))}
        </ul>
        <TableWrap label="Permissions by role">
          <table className="mt-5 w-full min-w-[44rem] text-callout">
            <thead>
              <tr>
                <th className={th}>Permission</th>
                {STAFF_ROLES.map((r) => (
                  <th key={r} className={cn(th, "text-center")}>
                    {STAFF_ROLE_LABEL[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(STAFF_PERMISSIONS) as StaffPermission[]).map((perm) => (
                <tr key={perm}>
                  <td className={td}>{STAFF_PERMISSIONS[perm]}</td>
                  {STAFF_ROLES.map((r) => (
                    <td key={r} className={cn(td, "text-center")}>
                      {staffCan({ staffRole: r }, perm) ? (
                        <span className="font-bold text-positive" aria-label="Yes">
                          ✓
                        </span>
                      ) : (
                        <span className="text-ink-muted" aria-label="No">
                          ·
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
