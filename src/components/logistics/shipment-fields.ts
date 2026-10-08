import type { FieldSpec } from "@/components/admin/spec-form";
import { SHIP_MODE_LABEL } from "@/lib/freight";
import type { ShipmentInput } from "@/server/logistics/shipments";

/** The shipment form's fields, filled with `v`. */
export function shipmentFields(v: ShipmentInput): FieldSpec[] {
  return [
    { kind: "select", id: "mode", label: "How it travelled", options: Object.entries(SHIP_MODE_LABEL).map(([value, label]) => ({ value, label })), defaultValue: v.mode },
    { kind: "text", id: "carrier", label: "Carrier or forwarder (optional)", defaultValue: v.carrier },
    { kind: "text", id: "originCountry", label: "From country", hint: "Two letters, such as ZA.", defaultValue: v.originCountry, autoComplete: "off" },
    { kind: "text", id: "destinationCountry", label: "To country", hint: "Two letters, such as BW.", defaultValue: v.destinationCountry },
    { kind: "text", id: "reference", label: "Waybill or bill of lading (optional)", defaultValue: v.reference },
    { kind: "text", id: "currency", label: "Costs paid in", hint: "Three letters, such as ZAR.", defaultValue: v.currency },
    { kind: "text", id: "weightKg", label: "Gross weight (kg)", inputMode: "decimal", defaultValue: v.weightKg },
    { kind: "text", id: "volumeM3", label: "Volume (cubic metres, optional)", inputMode: "decimal", hint: "For volumetric weight.", defaultValue: v.volumeM3 },
    { kind: "text", id: "freight", label: "Freight", inputMode: "decimal", defaultValue: v.freight },
    { kind: "text", id: "insurance", label: "Insurance", inputMode: "decimal", defaultValue: v.insurance },
    { kind: "text", id: "duties", label: "Duties and VAT paid at the border", inputMode: "decimal", defaultValue: v.duties },
    { kind: "text", id: "clearing", label: "Clearing agent fees", inputMode: "decimal", defaultValue: v.clearing },
    { kind: "text", id: "other", label: "Other costs", inputMode: "decimal", hint: "Such as storage or local delivery.", defaultValue: v.other },
    { kind: "text", id: "goodsValue", label: "Value of the goods (optional)", inputMode: "decimal", hint: "Used to learn the insurance rate.", defaultValue: v.goodsValue },
    { kind: "text", id: "shippedOn", label: "Shipped on (optional)", type: "date", defaultValue: v.shippedOn },
    { kind: "text", id: "arrivedOn", label: "Arrived on (optional)", type: "date", defaultValue: v.arrivedOn },
    { kind: "text", id: "transitDays", label: "Days in transit (optional)", inputMode: "numeric", hint: "Worked out from the dates when you give both.", defaultValue: v.transitDays },
    { kind: "textarea", id: "notes", label: "Notes (optional)", defaultValue: v.notes },
  ];
}
