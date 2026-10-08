import tokens from "@brand/tokens/tokens.json";
import { company } from "@/config/app";

/**
 * The frame every email shares. Email clients ignore stylesheets, so the
 * token values are written inline here, still read from tokens.json.
 */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface EmailBody {
  heading: string;
  /** Plain paragraphs. Escaped. */
  paragraphs: string[];
  /** A one-time code, shown large. */
  code?: string;
  /** Short lines, such as an order's items. Escaped. */
  list?: string[];
  /** A framed block that keeps its line breaks, such as bank details. Escaped. */
  box?: { title: string; text: string };
  button?: { label: string; url: string };
  /** Small print at the end. */
  footnote?: string;
}

export function renderEmail(body: EmailBody, appUrl: string, legalName: string): { text: string; html: string } {
  const t = tokens.light;
  const font = tokens.font.family;
  const text = [
    body.heading,
    "",
    ...body.paragraphs.flatMap((p) => [p, ""]),
    ...(body.code ? [body.code, ""] : []),
    ...(body.list?.length ? [...body.list, ""] : []),
    ...(body.box ? [body.box.title, body.box.text, ""] : []),
    ...(body.button ? [`${body.button.label}: ${body.button.url}`, ""] : []),
    ...(body.footnote ? [body.footnote, ""] : []),
    company.name,
    appUrl,
  ].join("\n");

  const code = body.code
    ? `<p style="margin:0 0 24px;font-size:32px;line-height:40px;font-weight:700;letter-spacing:0.2em;color:${t.text};font-variant-numeric:tabular-nums">${escapeHtml(body.code)}</p>`
    : "";
  const list = body.list?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-top:1px solid ${t.border}">${body.list.map((l) => `<tr><td style="padding:8px 0;border-bottom:1px solid ${t.border};font-size:15px;line-height:22px">${escapeHtml(l)}</td></tr>`).join("")}</table>`
    : "";
  const box = body.box
    ? `<div style="margin:0 0 24px;padding:16px;border:1px solid ${t.border};border-radius:${tokens.radius.md};background:${t.surface}"><p style="margin:0 0 8px;font-weight:700">${escapeHtml(body.box.title)}</p><p style="margin:0;white-space:pre-line;font-size:15px;line-height:22px">${escapeHtml(body.box.text)}</p></div>`
    : "";
  const button = body.button
    ? `<p style="margin:0 0 24px"><a href="${escapeHtml(body.button.url)}" style="display:inline-block;background:${t.primary};color:${t.onPrimary};text-decoration:none;font-weight:600;padding:12px 20px;border-radius:${tokens.radius.md}">${escapeHtml(body.button.label)}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:${t.surface};font-family:${font};color:${t.text}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${t.bg};border:1px solid ${t.border};border-radius:${tokens.radius.lg}">
<tr><td style="padding:32px">
<img src="${escapeHtml(appUrl)}/brand/png/ictd-logo-640.png" width="180" alt="${escapeHtml(company.name)}" style="display:block;margin:0 0 32px;height:auto">
<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;color:${t.text}">${escapeHtml(body.heading)}</h1>
${body.paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px">${escapeHtml(p)}</p>`).join("")}
${code}${list}${box}${button}
${body.footnote ? `<p style="margin:0;font-size:14px;line-height:20px;color:${t.textMuted}">${escapeHtml(body.footnote)}</p>` : ""}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:${t.textMuted}">${escapeHtml(legalName)}</p>
</td></tr></table></body></html>`;
  return { text, html };
}
