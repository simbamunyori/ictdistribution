import type { Metadata } from "next";
import Link from "next/link";
import { SpecialForm } from "@/components/admin/shop-forms";
import { Card, PageHeader } from "@/components/ui/card";
import { requireStaff } from "@/server/auth/next";
import { staffCan } from "@/server/staff/access";
import { blankSpecial, specialFormOptions } from "../form-data";

export const metadata: Metadata = { title: "Add special" };

export default async function NewSpecial() {
  const session = await requireStaff();
  const canEdit = staffCan({ staffRole: session.user.staffRole }, "manageShop");
  const options = await specialFormOptions();
  return (
    <>
      <p className="mb-2 text-callout">
        <Link href="/admin/specials" className="text-link underline underline-offset-4">
          Specials
        </Link>
      </p>
      <PageHeader title="Add special" lead="It shows in the shop from its start time, with a countdown to its end." />
      <Card className="max-w-3xl">
        <SpecialForm special={blankSpecial()} readOnly={!canEdit} {...options} />
      </Card>
    </>
  );
}
