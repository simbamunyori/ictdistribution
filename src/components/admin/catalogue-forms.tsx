"use client";

import { useActionState } from "react";
import {
  applyPriceListAction,
  categoryAction,
  columnsAction,
  contactAction,
  datasheetAction,
  defaultRuleAction,
  imageAction,
  linkAction,
  offerAction,
  productAction,
  scheduleAction,
  specFieldAction,
  specsAction,
  suggestionsAction,
  supplierAction,
  supplierCategoriesAction,
  supplierEventAction,
  uploadPriceListAction,
} from "@/app/admin/(console)/catalogue-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField, FileField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import type { ActionState } from "@/server/action-state";
import { Outcome } from "./forms";

type Option = { value: string; label: string };
const initial = {} as ActionState;

function Submit({ pending, label, pendingLabel = "Saving", disabled }: { pending: boolean; label: string; pendingLabel?: string; disabled?: boolean }) {
  return (
    <div>
      <Button type="submit" disabled={pending || disabled}>
        {pending ? pendingLabel : label}
      </Button>
    </div>
  );
}

export const RULE_OPTIONS: Option[] = [
  { value: "CHEAPEST_LANDED", label: "Cheapest landed cost" },
  { value: "FASTEST", label: "Fastest" },
  { value: "PREFERRED", label: "Preferred supplier" },
];

// ─── Categories ──────────────────────────────────────────────────────

export interface CategoryFormValues {
  id?: string;
  name: string;
  slug: string;
  description: string;
  parentId: string;
  sortOrder: string;
  active: boolean;
  sourcingRule: string;
  hsCode: string;
}

export function CategoryForm({ category, parents, readOnly }: { category: CategoryFormValues; parents: Option[]; readOnly: boolean }) {
  const [state, action, pending] = useActionState(categoryAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {category.id ? <input type="hidden" name="id" value={category.id} /> : null}
      <div className="grid gap-5 md:grid-cols-2">
        <TextField id="name" label="Name" defaultValue={v.name ?? category.name} error={err.name} disabled={readOnly} />
        <TextField id="slug" label="Address" defaultValue={v.slug ?? category.slug} error={err.slug} disabled={readOnly} hint={category.id ? "Changing it breaks links people have saved." : "Made from the name when left empty."} />
        <SelectField id="parentId" label="Sits under" options={parents} placeholder="Nothing (a top-level category)" defaultValue={v.parentId ?? category.parentId} error={err.parentId} disabled={readOnly} />
        <SelectField id="sourcingRule" label="Supplier rule" options={RULE_OPTIONS} placeholder="Follow the parent or the default" defaultValue={v.sourcingRule ?? category.sourcingRule} error={err.sourcingRule} disabled={readOnly} />
        <TextField id="sortOrder" label="Order in lists" inputMode="numeric" defaultValue={v.sortOrder ?? category.sortOrder} error={err.sortOrder} disabled={readOnly} />
        <TextField id="hsCode" label="Customs tariff (HS) code (optional)" inputMode="numeric" defaultValue={v.hsCode ?? category.hsCode} error={err.hsCode} disabled={readOnly} hint="For commercial invoices. Empty follows the category above." />
      </div>
      <TextAreaField id="description" label="Description" rows={2} defaultValue={v.description ?? category.description} error={err.description} disabled={readOnly} />
      <CheckboxField id="active" label="Show in the shop" hint="Hidden categories keep their products out of the shop." defaultChecked={category.active} disabled={readOnly} />
      <Outcome state={state} />
      {readOnly ? null : <Submit pending={pending} label={category.id ? "Save" : "Add category"} />}
    </form>
  );
}

export interface SpecFieldValues {
  id?: string;
  label: string;
  key: string;
  kind: string;
  unit: string;
  options: string;
  filterable: boolean;
  highlight: boolean;
  mustMatch: boolean;
  sortOrder: string;
}

export function SpecFieldForm({ categoryId, spec, kinds, readOnly }: { categoryId: string; spec: SpecFieldValues; kinds: Option[]; readOnly: boolean }) {
  const [state, action, pending] = useActionState(specFieldAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const p = (k: string) => `${spec.id ?? "new"}-${k}`;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="categoryId" value={categoryId} />
      {spec.id ? <input type="hidden" name="id" value={spec.id} /> : null}
      <div className="grid gap-4 md:grid-cols-3">
        <TextField id={p("label")} name="label" label="Name" defaultValue={v.label ?? spec.label} error={err.label} disabled={readOnly} />
        {spec.id ? (
          <TextField id={p("key")} label="Kept as" value={spec.key} disabled hint="Fixed, so values stay with it." readOnly />
        ) : (
          <TextField id={p("key")} name="key" label="Kept as (optional)" defaultValue={v.key ?? ""} error={err.key} disabled={readOnly} hint="Made from the name when left empty." />
        )}
        {spec.id ? (
          <TextField id={p("kind")} label="Kind" value={kinds.find((k) => k.value === spec.kind)?.label ?? spec.kind} disabled readOnly />
        ) : (
          <SelectField id={p("kind")} name="kind" label="Kind" options={kinds} defaultValue={v.kind ?? spec.kind} error={err.kind} disabled={readOnly} />
        )}
        <TextField id={p("unit")} name="unit" label="Unit, for numbers" defaultValue={v.unit ?? spec.unit} error={err.unit} disabled={readOnly} hint="Such as GB, W or inch." />
        <TextField id={p("sortOrder")} name="sortOrder" label="Order" inputMode="numeric" defaultValue={v.sortOrder ?? spec.sortOrder} error={err.sortOrder} disabled={readOnly} />
      </div>
      <TextAreaField id={p("options")} name="options" label="Options, for one of a list" rows={3} defaultValue={v.options ?? spec.options} error={err.options} disabled={readOnly} hint="One per line, in the order shoppers see them." />
      <div className="flex flex-col gap-3 md:flex-row md:gap-6">
        <CheckboxField id={p("filterable")} name="filterable" label="Shoppers can filter by it" defaultChecked={spec.filterable} disabled={readOnly} />
        <CheckboxField id={p("highlight")} name="highlight" label="Show on product cards" defaultChecked={spec.highlight} disabled={readOnly} />
        <CheckboxField id={p("mustMatch")} name="mustMatch" label="Suggested items must match" defaultChecked={spec.mustMatch} disabled={readOnly} />
      </div>
      <Outcome state={state} />
      {readOnly ? null : <Submit pending={pending} label={spec.id ? "Save" : "Add specification"} />}
    </form>
  );
}

export function SuggestionsForm({ categoryId, options, chosen, readOnly }: { categoryId: string; options: Option[]; chosen: string[]; readOnly: boolean }) {
  const [state, action, pending] = useActionState(suggestionsAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={categoryId} />
      <fieldset>
        <legend className="sr-only">Suggest products from</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {options.map((o) => (
            <CheckboxField key={o.value} id={`suggest-${o.value}`} name="related" value={o.value} label={o.label} defaultChecked={chosen.includes(o.value)} disabled={readOnly} />
          ))}
        </div>
      </fieldset>
      <Outcome state={state} />
      {readOnly ? null : <Submit pending={pending} label="Save suggestions" />}
    </form>
  );
}

// ─── Products ────────────────────────────────────────────────────────

export interface ProductFormValues {
  id?: string;
  name: string;
  brand: string;
  mpn: string;
  categoryId: string;
  slug: string;
  summary: string;
  description: string;
  warrantyMonths: string;
  warrantyTerms: string;
  sellToIndividuals: boolean;
  status: string;
  sourcingRule: string;
  weightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
}

const STATUS_OPTIONS: Option[] = [
  { value: "DRAFT", label: "Draft, only staff see it" },
  { value: "ACTIVE", label: "In the shop" },
  { value: "ARCHIVED", label: "Archived, no longer sold" },
];

export function ProductForm({ product, categories, brands, readOnly }: { product: ProductFormValues; categories: Option[]; brands: string[]; readOnly: boolean }) {
  const [state, action, pending] = useActionState(productAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {product.id ? <input type="hidden" name="id" value={product.id} /> : null}
      <TextField id="name" label="Name" defaultValue={v.name ?? product.name} error={err.name} disabled={readOnly} hint="What it is, without the brand: ThinkPad E14 Gen 6, Core i5, 16 GB, 512 GB." />
      <div className="grid gap-5 md:grid-cols-2">
        <TextField id="brand" label="Brand" list="brand-names" autoComplete="off" defaultValue={v.brand ?? product.brand} error={err.brand} disabled={readOnly} />
        <datalist id="brand-names">
          {brands.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        <TextField id="mpn" label="Manufacturer part number" defaultValue={v.mpn ?? product.mpn} error={err.mpn} disabled={readOnly} hint="Price lists match on it." />
        <SelectField id="categoryId" label="Category" options={categories} placeholder="Choose a category" defaultValue={v.categoryId ?? product.categoryId} error={err.categoryId} disabled={readOnly} />
        <SelectField id="status" label="Status" options={STATUS_OPTIONS} defaultValue={v.status ?? product.status} error={err.status} disabled={readOnly} />
        <TextField id="warrantyMonths" label="Warranty (months)" inputMode="numeric" defaultValue={v.warrantyMonths ?? product.warrantyMonths} error={err.warrantyMonths} disabled={readOnly} />
        <TextField id="warrantyTerms" label="Warranty terms" defaultValue={v.warrantyTerms ?? product.warrantyTerms} error={err.warrantyTerms} disabled={readOnly} hint="Such as: Manufacturer, carry-in." />
        <SelectField id="sourcingRule" label="Supplier rule" options={RULE_OPTIONS} placeholder="Follow the category" defaultValue={v.sourcingRule ?? product.sourcingRule} error={err.sourcingRule} disabled={readOnly} />
        <TextField id="slug" label={product.id ? "Address" : "Address (optional)"} defaultValue={v.slug ?? product.slug} error={err.slug} disabled={readOnly} hint={product.id ? "Changing it breaks links people have saved." : "Made from the brand and name when left empty."} />
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold">Boxed for shipping</legend>
        <p className="text-callout text-ink-muted">One unit in its box. Freight and duty are estimated from these; without them the supplier&apos;s landed cost allowance is used.</p>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <TextField id="weightKg" label="Weight (kg)" inputMode="decimal" defaultValue={v.weightKg ?? product.weightKg} error={err.weightKg} disabled={readOnly} />
          <TextField id="lengthCm" label="Length (cm)" inputMode="decimal" defaultValue={v.lengthCm ?? product.lengthCm} error={err.lengthCm} disabled={readOnly} />
          <TextField id="widthCm" label="Width (cm)" inputMode="decimal" defaultValue={v.widthCm ?? product.widthCm} error={err.widthCm} disabled={readOnly} />
          <TextField id="heightCm" label="Height (cm)" inputMode="decimal" defaultValue={v.heightCm ?? product.heightCm} error={err.heightCm} disabled={readOnly} />
        </div>
      </fieldset>
      <TextAreaField id="summary" label="Summary" rows={2} defaultValue={v.summary ?? product.summary} error={err.summary} disabled={readOnly} hint="One or two sentences for cards and search results." />
      <TextAreaField id="description" label="Description" rows={6} defaultValue={v.description ?? product.description} error={err.description} disabled={readOnly} hint="Blank lines start new paragraphs." />
      <CheckboxField id="sellToIndividuals" label="Sell to individuals" hint="Shown with a price to everyone in the shop. Otherwise shoppers are asked to register a business." defaultChecked={product.sellToIndividuals} disabled={readOnly} />
      <Outcome state={state} />
      {readOnly ? null : <Submit pending={pending} label={product.id ? "Save" : "Add product"} />}
    </form>
  );
}

export interface SpecInput {
  key: string;
  label: string;
  kind: "TEXT" | "NUMBER" | "YES_NO" | "CHOICE";
  unit: string;
  options: string[];
  value: string;
}

export function SpecsForm({ productId, fields, readOnly }: { productId: string; fields: SpecInput[]; readOnly: boolean }) {
  const [state, action, pending] = useActionState(specsAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  if (!fields.length) return <p className="text-ink-muted">This category has no specifications yet. Add them on the category&apos;s page.</p>;
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="id" value={productId} />
      <div className="grid gap-5 md:grid-cols-2">
        {fields.map((f) => {
          const id = `spec-${f.key}`;
          const name = `spec.${f.key}`;
          const value = v[name] ?? f.value;
          const label = f.unit ? `${f.label} (${f.unit})` : f.label;
          if (f.kind === "CHOICE" || f.kind === "YES_NO") {
            const options = f.kind === "YES_NO" ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] : f.options.map((o) => ({ value: o, label: o }));
            return (
              <div key={f.key}>
                {f.kind === "YES_NO" ? <input type="hidden" name="yesNo" value={f.key} /> : null}
                <SelectField id={id} name={name} label={label} options={options} placeholder="Not given" defaultValue={value} error={err[name]} disabled={readOnly} />
              </div>
            );
          }
          return <TextField key={f.key} id={id} name={name} label={label} inputMode={f.kind === "NUMBER" ? "decimal" : undefined} defaultValue={value} error={err[name]} disabled={readOnly} />;
        })}
      </div>
      <Outcome state={state} />
      {readOnly ? null : <Submit pending={pending} label="Save specifications" />}
    </form>
  );
}

export function ImageUploadForm({ productId }: { productId: string }) {
  const [state, action, pending] = useActionState(imageAction, initial);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="productId" value={productId} />
      <div className="grid gap-4 md:grid-cols-2">
        <FileField id="image-file" name="file" label="Image" accept="image/jpeg,image/png,image/webp,image/avif" error={err.file} hint="JPEG, PNG, WebP or AVIF, up to 8 MB. Stored as WebP." />
        <TextField id="image-alt" name="alt" label="What it shows" error={err.alt} hint="For people who can't see it: the front, with the lid open." />
      </div>
      <Outcome state={state} />
      <Submit pending={pending} label="Upload image" pendingLabel="Uploading" />
    </form>
  );
}

export function DatasheetForm({ productId }: { productId: string }) {
  const [state, action, pending] = useActionState(datasheetAction, initial);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="productId" value={productId} />
      <div className="grid gap-4 md:grid-cols-2">
        <FileField id="datasheet-file" name="file" label="Datasheet" accept="application/pdf" error={err.file} hint="PDF, up to 20 MB." />
        <TextField id="datasheet-title" name="title" label="Title" placeholder="Datasheet" error={err.title} />
      </div>
      <Outcome state={state} />
      <Submit pending={pending} label="Upload datasheet" pendingLabel="Uploading" />
    </form>
  );
}

export function LinkForm({ productId }: { productId: string }) {
  const [state, action, pending] = useActionState(linkAction, initial);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="productId" value={productId} />
      <TextField id="reference" label="Part number or product address" defaultValue={state.values?.reference ?? ""} error={err.reference} hint="The other product shows this one too." />
      {state.error ? <Alert>{state.error}</Alert> : null}
      <Submit pending={pending} label="Link products" />
    </form>
  );
}

export function OfferForm({ productId, suppliers, offer, readOnly }: { productId: string; suppliers: (Option & { currency: string })[]; offer?: { id: string; supplierId: string; cost: string; supplierSku: string; leadTimeDays: string; moq: string; stock: string; active: boolean }; readOnly: boolean }) {
  const [state, action, pending] = useActionState(offerAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const p = (k: string) => `${offer?.id ?? "new"}-offer-${k}`;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="productId" value={productId} />
      {offer ? (
        <>
          <input type="hidden" name="id" value={offer.id} />
          <input type="hidden" name="supplierId" value={offer.supplierId} />
        </>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        {offer ? null : <SelectField id={p("supplier")} name="supplierId" label="Supplier" options={suppliers.map((s) => ({ value: s.value, label: `${s.label} (${s.currency})` }))} placeholder="Choose a supplier" defaultValue={v.supplierId ?? ""} error={err.supplierId} disabled={readOnly} />}
        <TextField id={p("cost")} name="cost" label="Their price" inputMode="decimal" defaultValue={v.cost ?? offer?.cost ?? ""} error={err.cost} disabled={readOnly} hint="In their currency, before freight and duties." />
        <TextField id={p("sku")} name="supplierSku" label="Their code (optional)" defaultValue={v.supplierSku ?? offer?.supplierSku ?? ""} error={err.supplierSku} disabled={readOnly} />
        <TextField id={p("lead")} name="leadTimeDays" label="Lead time in days (optional)" inputMode="numeric" defaultValue={v.leadTimeDays ?? offer?.leadTimeDays ?? ""} error={err.leadTimeDays} disabled={readOnly} hint="Empty uses their usual." />
        <TextField id={p("moq")} name="moq" label="Minimum order" inputMode="numeric" defaultValue={v.moq ?? offer?.moq ?? "1"} error={err.moq} disabled={readOnly} />
        <TextField id={p("stock")} name="stock" label="Their stock (optional)" inputMode="numeric" defaultValue={v.stock ?? offer?.stock ?? ""} error={err.stock} disabled={readOnly} />
        {offer ? <SelectField id={p("active")} name="active" label="Use this offer" options={[{ value: "on", label: "Yes" }, { value: "off", label: "No, switched off" }]} defaultValue={offer.active ? "on" : "off"} disabled={readOnly} /> : null}
      </div>
      <Outcome state={state} />
      {readOnly ? null : <Submit pending={pending} label={offer ? "Save offer" : "Add offer"} />}
    </form>
  );
}

// ─── Suppliers ───────────────────────────────────────────────────────

export interface SupplierFormValues {
  id?: string;
  name: string;
  kind: string;
  country: string;
  currency: string;
  email: string;
  whatsapp: string;
  phone: string;
  website: string;
  portalUrl: string;
  notes: string;
  leadTimeDays: string;
  minOrder: string;
  landedCostPercent: string;
  freightMode: string;
  preferred: boolean;
  active: boolean;
}

const MODE_OPTIONS: Option[] = [
  { value: "ROAD", label: "Road" },
  { value: "AIR", label: "Air freight" },
  { value: "SEA", label: "Sea freight" },
  { value: "COURIER", label: "Courier" },
];

const KIND_OPTIONS: Option[] = [
  { value: "LOCAL", label: "Local distributor" },
  { value: "INTERNATIONAL", label: "International" },
  { value: "CHINA", label: "China-based" },
];

export function SupplierForm({ supplier, countries, currencies, readOnly }: { supplier: SupplierFormValues; countries: Option[]; currencies: Option[]; readOnly: boolean }) {
  const [state, action, pending] = useActionState(supplierAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {supplier.id ? <input type="hidden" name="id" value={supplier.id} /> : null}
      <div className="grid gap-5 md:grid-cols-2">
        <TextField id="name" label="Name" defaultValue={v.name ?? supplier.name} error={err.name} disabled={readOnly} />
        <SelectField id="kind" label="Kind" options={KIND_OPTIONS} defaultValue={v.kind ?? supplier.kind} error={err.kind} disabled={readOnly} />
        <SelectField id="country" label="Country" options={countries} placeholder="Choose a country" defaultValue={v.country ?? supplier.country} error={err.country} disabled={readOnly} />
        <SelectField id="currency" label="They bill in" options={currencies} defaultValue={v.currency ?? supplier.currency} error={err.currency} disabled={readOnly} hint="Add currencies at Markets." />
        <TextField id="email" label="Email (optional)" type="email" defaultValue={v.email ?? supplier.email} error={err.email} disabled={readOnly} />
        <TextField id="whatsapp" label="WhatsApp (optional)" type="tel" defaultValue={v.whatsapp ?? supplier.whatsapp} error={err.whatsapp} disabled={readOnly} hint="International format, like +86 138 0000 0000." />
        <TextField id="phone" label="Phone (optional)" type="tel" defaultValue={v.phone ?? supplier.phone} error={err.phone} disabled={readOnly} />
        <TextField id="portalUrl" label="Supplier portal (optional)" defaultValue={v.portalUrl ?? supplier.portalUrl} error={err.portalUrl} disabled={readOnly} />
        <TextField id="website" label="Website (optional)" defaultValue={v.website ?? supplier.website} error={err.website} disabled={readOnly} />
        <TextField id="leadTimeDays" label="Usual lead time (days)" inputMode="numeric" defaultValue={v.leadTimeDays ?? supplier.leadTimeDays} error={err.leadTimeDays} disabled={readOnly} hint="From our order to goods in our hands." />
        <TextField id="minOrder" label="Minimum order value (optional)" inputMode="decimal" defaultValue={v.minOrder ?? supplier.minOrder} error={err.minOrder} disabled={readOnly} hint="In their currency." />
        <TextField id="landedCostPercent" label="Freight, duties and clearing %" inputMode="decimal" defaultValue={v.landedCostPercent ?? supplier.landedCostPercent} error={err.landedCostPercent} disabled={readOnly} hint="Used when freight can't be estimated: a product without its weight, or a route with no shipments yet." />
        <SelectField id="freightMode" label="How their goods travel to us" options={MODE_OPTIONS} defaultValue={v.freightMode ?? supplier.freightMode} error={err.freightMode} disabled={readOnly} hint="Freight is estimated from our shipments on this route and mode." />
      </div>
      <TextAreaField id="notes" label="Notes" rows={3} defaultValue={v.notes ?? supplier.notes} error={err.notes} disabled={readOnly} />
      <CheckboxField id="preferred" label="Preferred supplier" hint="Chosen first where the supplier rule is Preferred supplier." defaultChecked={supplier.preferred} disabled={readOnly} />
      <CheckboxField id="active" label="Buying from them" hint="Switched-off suppliers are never chosen." defaultChecked={supplier.active} disabled={readOnly} />
      <Outcome state={state} />
      {readOnly ? null : <Submit pending={pending} label={supplier.id ? "Save" : "Add supplier"} />}
    </form>
  );
}

export function SupplierCategoriesForm({ supplierId, options, chosen, readOnly }: { supplierId: string; options: Option[]; chosen: string[]; readOnly: boolean }) {
  const [state, action, pending] = useActionState(supplierCategoriesAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={supplierId} />
      <fieldset>
        <legend className="sr-only">Categories they supply</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {options.map((o) => (
            <CheckboxField key={o.value} id={`supplies-${o.value}`} name="categoryId" value={o.value} label={o.label} defaultChecked={chosen.includes(o.value)} disabled={readOnly} />
          ))}
        </div>
      </fieldset>
      <Outcome state={state} />
      {readOnly ? null : <Submit pending={pending} label="Save categories" />}
    </form>
  );
}

export function ContactForm({ supplierId }: { supplierId: string }) {
  const [state, action, pending] = useActionState(contactAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="supplierId" value={supplierId} />
      <div className="grid gap-4 md:grid-cols-2">
        <TextField id="contact-name" name="name" label="Name" defaultValue={v.name ?? ""} error={err.name} />
        <TextField id="contact-role" name="role" label="Role (optional)" defaultValue={v.role ?? ""} error={err.role} hint="Such as Account manager." />
        <TextField id="contact-email" name="email" label="Email" type="email" defaultValue={v.email ?? ""} error={err.email} />
        <TextField id="contact-phone" name="phone" label="Phone" type="tel" defaultValue={v.phone ?? ""} error={err.phone} />
        <TextField id="contact-whatsapp" name="whatsapp" label="WhatsApp" type="tel" defaultValue={v.whatsapp ?? ""} error={err.whatsapp} />
      </div>
      <Outcome state={state} />
      <Submit pending={pending} label="Add contact" />
    </form>
  );
}

export function SupplierEventForm({ supplierId, kinds, today }: { supplierId: string; kinds: Option[]; today: string }) {
  const [state, action, pending] = useActionState(supplierEventAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="supplierId" value={supplierId} />
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField id="event-kind" name="kind" label="What happened" options={kinds} defaultValue={v.kind ?? "ON_TIME"} error={err.kind} />
        <TextField id="event-date" name="occurredOn" label="Date" type="date" max={today} defaultValue={v.occurredOn ?? today} error={err.occurredOn} />
        <TextField id="event-reference" name="reference" label="Reference (optional)" defaultValue={v.reference ?? ""} error={err.reference} hint="Their invoice or our order number." />
      </div>
      <TextAreaField id="event-note" name="note" label="Note" rows={2} defaultValue={v.note ?? ""} error={err.note} />
      <Outcome state={state} />
      <Submit pending={pending} label="Record it" />
    </form>
  );
}

export function DefaultRuleForm({ current, readOnly }: { current: string; readOnly: boolean }) {
  const [state, action, pending] = useActionState(defaultRuleAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <SelectField id="rule" label="Default supplier rule" options={RULE_OPTIONS} defaultValue={current} disabled={readOnly} hint="For products whose category and product don't set their own." />
      <Outcome state={state} />
      {readOnly ? null : <Submit pending={pending} label="Save" />}
    </form>
  );
}

// ─── Price lists ─────────────────────────────────────────────────────

export function UploadPriceListForm({ supplierId }: { supplierId: string }) {
  const [state, action, pending] = useActionState(uploadPriceListAction, initial);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="supplierId" value={supplierId} />
      <FileField id="price-list" name="file" label="Price list" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" error={err.file ?? err.sheet} hint="CSV or Excel (.xlsx), up to 10 MB. Nothing changes until you review and apply it." />
      {state.error ? <Alert>{state.error}</Alert> : null}
      <Submit pending={pending} label="Upload and compare" pendingLabel="Reading the list" />
    </form>
  );
}

export function ColumnsForm({
  supplierId,
  importId,
  headers,
  fields,
  columns,
  sheets,
  sheet,
  headerRow,
  currencies,
  currency,
}: {
  supplierId: string;
  importId: string;
  headers: string[];
  fields: { key: string; label: string; required: boolean }[];
  columns: Record<string, string | undefined>;
  sheets: string[];
  sheet: string | null;
  headerRow: number;
  currencies: Option[];
  currency: string | null;
}) {
  const [state, action, pending] = useActionState(columnsAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const headerOptions = headers.filter(Boolean).map((h) => ({ value: h, label: h }));
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="supplierId" value={supplierId} />
      <input type="hidden" name="importId" value={importId} />
      <div className="grid gap-5 md:grid-cols-3">
        {sheets.length > 1 ? <SelectField id="sheet" label="Sheet" options={sheets.map((s) => ({ value: s, label: s }))} defaultValue={v.sheet ?? sheet ?? ""} /> : null}
        <TextField id="headerRow" label="Headings are on row" inputMode="numeric" defaultValue={v.headerRow ?? String(headerRow)} error={err.headerRow} />
        <SelectField id="currency" label="Prices are in" options={currencies} placeholder="The supplier's currency" defaultValue={v.currency ?? currency ?? ""} error={err.currency} />
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        {fields.map((f) => (
          <SelectField
            key={f.key}
            id={`col-${f.key}`}
            name={`col.${f.key}`}
            label={f.required ? f.label : `${f.label} (optional)`}
            options={headerOptions}
            placeholder={f.required ? "Choose a column" : "Not in this list"}
            defaultValue={v[`col.${f.key}`] ?? columns[f.key] ?? ""}
            error={err[`col.${f.key}`]}
          />
        ))}
      </div>
      <Outcome state={state} />
      <Submit pending={pending} label="Save and compare" pendingLabel="Comparing" />
    </form>
  );
}

export function ApplyPriceListForm({ supplierId, importId, deactivateMissing, categories, unmatched }: { supplierId: string; importId: string; deactivateMissing: boolean; categories: Option[]; unmatched: number }) {
  const [state, action, pending] = useActionState(applyPriceListAction, initial);
  const err = state.fieldErrors ?? {};
  if (state.ok) return <Alert tone="positive">{state.message}</Alert>;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="supplierId" value={supplierId} />
      <input type="hidden" name="importId" value={importId} />
      <CheckboxField id="deactivateMissing" label="Switch off offers missing from this list" hint="They stay on record and can be switched back on." defaultChecked={deactivateMissing} />
      {unmatched ? (
        <SelectField
          id="draftsCategoryId"
          label={`Add the ${unmatched} unmatched ${unmatched === 1 ? "line" : "lines"} as draft products in`}
          options={categories}
          placeholder="Don't add them"
          error={err.draftsCategoryId}
          hint="Only lines with a brand and a name. Drafts stay out of the shop until someone finishes them."
        />
      ) : null}
      {state.error ? <Alert>{state.error}</Alert> : null}
      <Submit pending={pending} label="Apply these changes" pendingLabel="Applying" />
    </form>
  );
}

export function ScheduleForm({ supplierId, values, readOnly }: { supplierId: string; values: { sourceUrl: string; schedule: string; autoApplyPercent: string; deactivateMissing: boolean }; readOnly: boolean }) {
  const [state, action, pending] = useActionState(scheduleAction, initial);
  const err = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="supplierId" value={supplierId} />
      <div className="grid gap-4 md:grid-cols-3">
        <TextField id="sourceUrl" label="Fetch from (https)" className="md:col-span-3" defaultValue={v.sourceUrl ?? values.sourceUrl} error={err.sourceUrl} disabled={readOnly} hint="An address that serves their latest list as CSV or Excel, such as a link from their portal." />
        <SelectField
          id="schedule"
          label="How often"
          options={[
            { value: "OFF", label: "Only when uploaded by hand" },
            { value: "DAILY", label: "Every day" },
            { value: "WEEKLY", label: "Every week" },
          ]}
          defaultValue={v.schedule ?? values.schedule}
          error={err.schedule}
          disabled={readOnly}
        />
        <TextField id="autoApplyPercent" label="Apply by itself under %" inputMode="decimal" defaultValue={v.autoApplyPercent ?? values.autoApplyPercent} error={err.autoApplyPercent} disabled={readOnly} hint="When no price moves more than this. Empty: always wait for review." />
      </div>
      <CheckboxField id="deactivateMissing" label="Switch off offers missing from a new list" hint="A scheduled list with missing offers always waits for review." defaultChecked={values.deactivateMissing} disabled={readOnly} />
      <Outcome state={state} />
      {readOnly ? null : <Submit pending={pending} label="Save schedule" />}
    </form>
  );
}
