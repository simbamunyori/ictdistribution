import type { DocumentKind, Prisma, PrismaClient, VerificationStatus } from "@prisma/client";
import { audit, staffAudit } from "@/server/audit";
import { imageType, isPdf, type Upload } from "@/server/catalogue/media";
import { queueEmail } from "@/server/email/outbox";
import { DomainError } from "@/server/errors";
import { assertCan, type Actor } from "@/server/org/access";
import { assertStaffCan, type StaffActor } from "@/server/staff/access";

/**
 * Checking a business before it gets trade prices. The Owner fills in the
 * company details and sends documents; staff look at them and approve, or
 * send it back with a note. Until it is approved the organisation buys at
 * retail prices like anyone else.
 */

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  NOT_SUBMITTED: "Not sent yet",
  PENDING: "Being checked",
  APPROVED: "Approved",
  REJECTED: "Needs changes",
};

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  REGISTRATION: "Certificate of incorporation or registration",
  TAX: "Tax or VAT registration",
  DIRECTOR_ID: "A director's ID or passport",
  ADDRESS: "Proof of address",
  OTHER: "Something else",
};

export const DOCUMENT_KINDS = Object.keys(DOCUMENT_KIND_LABEL) as DocumentKind[];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS = 12;
/** What must be sent before checking can start. */
export const REQUIRED_DOCUMENTS: DocumentKind[] = ["REGISTRATION", "TAX"];

type Member = Actor & { organisationId: string };

export interface BusinessDetailsInput {
  name: string;
  registrationNumber: string;
  taxNumber: string;
  address: string;
  directors: string;
}

const editable = (v: VerificationStatus) => v === "NOT_SUBMITTED" || v === "REJECTED";

function checkDetails(input: BusinessDetailsInput) {
  const fieldErrors: Record<string, string> = {};
  const name = input.name.trim().replace(/\s+/g, " ");
  const registrationNumber = input.registrationNumber.trim().toUpperCase();
  const taxNumber = input.taxNumber.trim().toUpperCase();
  const address = input.address.trim();
  const directors = input.directors
    .split(/\r?\n/)
    .map((d) => d.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (name.length < 2 || name.length > 120) fieldErrors.name = "Enter the registered name.";
  if (!/^[A-Z0-9][A-Z0-9 /.-]{2,39}$/.test(registrationNumber)) fieldErrors.registrationNumber = "Enter the company registration number as it is on the certificate.";
  if (!/^[A-Z0-9][A-Z0-9 /.-]{2,39}$/.test(taxNumber)) fieldErrors.taxNumber = "Enter the tax or VAT number.";
  if (address.length < 10 || address.length > 300) fieldErrors.address = "Enter the registered address.";
  if (!directors.length || directors.length > 12 || directors.some((d) => d.length < 3 || d.length > 80)) fieldErrors.directors = "Enter each director's full name on its own line.";
  if (Object.keys(fieldErrors).length) throw new DomainError("invalid", "Check the highlighted fields.", undefined, fieldErrors);
  return { name, registrationNumber, taxNumber, address, directors: directors.join("\n") };
}

async function orgFor(tx: Prisma.TransactionClient, actor: Member) {
  const org = await tx.organisation.findUnique({ where: { id: actor.organisationId } });
  if (!org) throw new DomainError("not-found", "No such organisation.");
  return org;
}

const customerAudit = (actor: Member) => ({ actorKind: "CUSTOMER" as const, actorUserId: actor.userId, actorLabel: actor.name, organisationId: actor.organisationId, visibleToCustomer: true });

/** The Owner fills in or corrects the company details. Locked while being checked and once approved. */
export async function saveBusinessDetails(db: PrismaClient, actor: Member, input: BusinessDetailsInput, ip?: string | null) {
  assertCan(actor, "manageOrganisation");
  const v = checkDetails(input);
  await db.$transaction(async (tx) => {
    const org = await orgFor(tx, actor);
    if (!editable(org.verification)) throw new DomainError("conflict", org.verification === "PENDING" ? "We're checking these details now. Contact us to change them." : "These details are approved. Contact us to change them.");
    await tx.organisation.update({ where: { id: org.id }, data: v });
    await audit(tx, { ...customerAudit(actor), action: "organisation.details-saved", summary: "Saved the company details", ipAddress: ip });
  });
}

export async function addDocument(db: PrismaClient, actor: Member, kindInput: string, file: Upload, ip?: string | null) {
  assertCan(actor, "manageOrganisation");
  const kind = kindInput as DocumentKind;
  if (!DOCUMENT_KINDS.includes(kind)) throw new DomainError("invalid", "Choose what the document is.", "kind");
  if (!file.bytes.length) throw new DomainError("invalid", "Choose a file.", "file");
  if (file.bytes.length > MAX_DOCUMENT_BYTES) throw new DomainError("invalid", "Documents can be up to 10 MB.", "file");
  const contentType = isPdf(file.bytes) ? "application/pdf" : imageType(file.bytes);
  if (!contentType || contentType === "image/avif") throw new DomainError("invalid", "Send a PDF, or a photo as JPEG, PNG or WebP.", "file");
  const ext = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[contentType] ?? "bin";
  const base = file.name.replace(/\.[^.]*$/, "").replace(/[^\w .()-]/g, "").trim().slice(0, 80) || "document";
  await db.$transaction(async (tx) => {
    const org = await orgFor(tx, actor);
    if (!editable(org.verification)) throw new DomainError("conflict", "We're checking your documents now, or have approved them. Contact us to add more.");
    if ((await tx.organisationDocument.count({ where: { organisationId: org.id } })) >= MAX_DOCUMENTS) throw new DomainError("invalid", `You can send up to ${MAX_DOCUMENTS} documents. Remove one first.`, "file");
    await tx.organisationDocument.create({ data: { organisationId: org.id, kind, filename: `${base}.${ext}`, contentType, bytes: file.bytes, size: file.bytes.length, uploadedByLabel: actor.name } });
    await audit(tx, { ...customerAudit(actor), action: "organisation.document-added", summary: `Added a document: ${DOCUMENT_KIND_LABEL[kind]}`, ipAddress: ip });
  });
}

export async function removeDocument(db: PrismaClient, actor: Member, documentId: string, ip?: string | null) {
  assertCan(actor, "manageOrganisation");
  await db.$transaction(async (tx) => {
    const org = await orgFor(tx, actor);
    if (!editable(org.verification)) throw new DomainError("conflict", "Documents can't be removed while we check them or once approved.");
    const doc = await tx.organisationDocument.findFirst({ where: { id: documentId, organisationId: org.id } });
    if (!doc) return;
    await tx.organisationDocument.delete({ where: { id: doc.id } });
    await audit(tx, { ...customerAudit(actor), action: "organisation.document-removed", summary: `Removed a document: ${DOCUMENT_KIND_LABEL[doc.kind]}`, ipAddress: ip });
  });
}

const MISSING_DOCUMENT: Partial<Record<DocumentKind, string>> = { REGISTRATION: "the registration certificate", TAX: "the tax certificate" };

/** What still stops the Owner sending it for checking. Empty when it can go. */
export function missingForCheck(org: { registrationNumber: string | null; taxNumber: string | null; address: string; directors: string }, kinds: DocumentKind[]): string[] {
  const missing: string[] = [];
  if (!org.registrationNumber || !org.taxNumber || !org.address || !org.directors) missing.push("the company details");
  for (const k of REQUIRED_DOCUMENTS) if (!kinds.includes(k)) missing.push(MISSING_DOCUMENT[k] ?? DOCUMENT_KIND_LABEL[k]);
  return missing;
}

export async function submitForCheck(db: PrismaClient, actor: Member, deps: { now?: Date }, ip?: string | null) {
  assertCan(actor, "manageOrganisation");
  await db.$transaction(async (tx) => {
    const org = await tx.organisation.findUnique({ where: { id: actor.organisationId }, include: { documents: { select: { kind: true } } } });
    if (!org) throw new DomainError("not-found", "No such organisation.");
    if (!editable(org.verification)) return;
    const missing = missingForCheck(org, org.documents.map((d) => d.kind));
    if (missing.length) throw new DomainError("invalid", `Add ${missing.join(" and ")} first.`);
    await tx.organisation.update({ where: { id: org.id }, data: { verification: "PENDING", submittedAt: deps.now ?? new Date(), verificationNote: null } });
    await audit(tx, { ...customerAudit(actor), action: "organisation.submitted", summary: "Sent the company details and documents to be checked", ipAddress: ip });
  });
}

// ─── Staff ───────────────────────────────────────────────────────────

export async function waitingChecks(db: Pick<PrismaClient, "organisation">) {
  return db.organisation.count({ where: { verification: "PENDING" } });
}

async function ownerEmails(tx: Prisma.TransactionClient, organisationId: string) {
  const owners = await tx.membership.findMany({ where: { organisationId, active: true, role: "OWNER" }, select: { user: { select: { email: true } } } });
  return owners.map((o) => o.user.email);
}

/** Approves a business: trade prices show from the next page they open. */
export async function approveOrganisation(db: PrismaClient, actor: StaffActor, deps: { key: string; now?: Date }, organisationId: string, ip?: string | null) {
  assertStaffCan(actor, "verifyCustomers");
  await db.$transaction(async (tx) => {
    const org = await tx.organisation.findUnique({ where: { id: organisationId }, include: { type: true } });
    if (!org) throw new DomainError("not-found", "No such customer.");
    if (org.verification === "APPROVED") return;
    if (org.verification !== "PENDING") throw new DomainError("conflict", "They haven't sent their details to be checked yet.");
    await tx.organisation.update({ where: { id: org.id }, data: { verification: "APPROVED", verifiedAt: deps.now ?? new Date(), verifiedByLabel: actor.name, verificationNote: null } });
    for (const to of await ownerEmails(tx, org.id)) await queueEmail(tx, deps.key, { to, kind: "organisation.approved", payload: { organisation: org.name, level: org.type.name } });
    await audit(tx, staffAudit(actor, { organisationId: org.id, action: "organisation.approved", summary: `Approved ${org.name} for ${org.type.name} prices`, visibleToCustomer: true, ipAddress: ip }));
  });
}

/** Sends it back with a note the customer reads, such as which document is unclear. Also withdraws an approval. */
export async function rejectOrganisation(db: PrismaClient, actor: StaffActor, deps: { key: string }, organisationId: string, noteInput: string, ip?: string | null) {
  assertStaffCan(actor, "verifyCustomers");
  const note = noteInput.trim();
  if (note.length < 5 || note.length > 500) throw new DomainError("invalid", "Say what they need to change, for the customer.", "note");
  await db.$transaction(async (tx) => {
    const org = await tx.organisation.findUnique({ where: { id: organisationId } });
    if (!org) throw new DomainError("not-found", "No such customer.");
    if (org.verification === "NOT_SUBMITTED") throw new DomainError("conflict", "They haven't sent their details to be checked yet.");
    const withdrawn = org.verification === "APPROVED";
    await tx.organisation.update({ where: { id: org.id }, data: { verification: "REJECTED", verificationNote: note, verifiedAt: null, verifiedByLabel: null } });
    for (const to of await ownerEmails(tx, org.id)) await queueEmail(tx, deps.key, { to, kind: "organisation.changes-needed", payload: { organisation: org.name, note } });
    await audit(tx, staffAudit(actor, { organisationId: org.id, action: withdrawn ? "organisation.approval-withdrawn" : "organisation.sent-back", summary: `${withdrawn ? "Withdrew trade prices" : "Asked for changes"}: ${note}`, visibleToCustomer: true, ipAddress: ip }));
  });
}

/** A document's file, for staff checking it. Every opening is in the audit log. */
export async function readDocument(db: PrismaClient, actor: StaffActor, documentId: string, ip?: string | null) {
  assertStaffCan(actor, "viewDocuments");
  const doc = await db.organisationDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw new DomainError("not-found", "No such document.");
  await audit(db, staffAudit(actor, { organisationId: doc.organisationId, action: "organisation.document-opened", summary: `Opened ${doc.filename}`, targetType: "OrganisationDocument", targetId: doc.id, ipAddress: ip }));
  return doc;
}
