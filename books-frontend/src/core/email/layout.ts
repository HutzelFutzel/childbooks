/**
 * The shared HTML + plain-text email shell and small rendering helpers.
 *
 * Emails are built as dependency-free, inline-styled, table-based HTML (the only
 * markup that renders consistently across Gmail, Outlook, Apple Mail, etc.).
 * Every template body is wrapped by {@link renderLayout} so the header (logo),
 * footer (contact + unsubscribe), colors and width are consistent and always
 * reflect the live brand kit passed in via {@link RenderContext}.
 */
import type { RenderContext } from "./types";

/** Escape a user/dynamic string for safe interpolation into HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Replace `{token}` occurrences with stringified values (used for subjects). */
export function applyTokens(template: string, tokens: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in tokens && tokens[key] != null ? String(tokens[key]) : whole,
  );
}

const CONTAINER_WIDTH = 600;

/** A branded call-to-action button (bulletproof-ish for Outlook via padding). */
export function button(label: string, href: string, brand: RenderContext["brand"]): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td align="center" bgcolor="${escapeHtml(brand.primaryColor)}" style="border-radius:8px;">
        <a href="${escapeHtml(href)}" target="_blank"
           style="display:inline-block;padding:12px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

/** A muted paragraph of body copy. */
export function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#334155;">${html}</p>`;
}

/** A large heading at the top of the body. */
export function heading(text: string, brand: RenderContext["brand"]): string {
  return `<h1 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.3;font-weight:700;color:${escapeHtml(
    brand.primaryColor,
  )};">${escapeHtml(text)}</h1>`;
}

/** A highlighted stat/callout box (e.g. Sparks amount, gift code). */
export function calloutBox(inner: string, brand: RenderContext["brand"]): string {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    <tr>
      <td style="background-color:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid ${escapeHtml(
        brand.accentColor,
      )};border-radius:8px;padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#334155;">
        ${inner}
      </td>
    </tr>
  </table>`;
}

function headerHtml(brand: RenderContext["brand"]): string {
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(
        brand.brandName,
      )}" height="36" style="display:block;height:36px;width:auto;border:0;outline:none;text-decoration:none;" />`
    : `<span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:${escapeHtml(
        brand.primaryColor,
      )};">${escapeHtml(brand.brandName)}</span>`;
  return `
    <tr>
      <td align="center" style="padding:28px 32px 8px;">
        <a href="${escapeHtml(brand.siteUrl || "#")}" target="_blank" style="text-decoration:none;">${logo}</a>
      </td>
    </tr>`;
}

function footerHtml(ctx: RenderContext): string {
  const { footer, brand, category } = ctx;
  const links: string[] = [];
  if (footer.supportEmail) {
    links.push(
      `Questions? <a href="mailto:${escapeHtml(footer.supportEmail)}" style="color:${escapeHtml(
        brand.primaryColor,
      )};text-decoration:underline;">${escapeHtml(footer.supportEmail)}</a>`,
    );
  }
  if (footer.supportUrl) {
    links.push(
      `<a href="${escapeHtml(footer.supportUrl)}" target="_blank" style="color:${escapeHtml(
        brand.primaryColor,
      )};text-decoration:underline;">Help center</a>`,
    );
  }
  const contactLine = links.length
    ? `<p style="margin:0 0 10px;">${links.join(" &nbsp;·&nbsp; ")}</p>`
    : "";

  const legal: string[] = [];
  if (footer.footerText) legal.push(escapeHtml(footer.footerText));
  if (footer.physicalAddress) legal.push(escapeHtml(footer.physicalAddress));

  // Unsubscribe is only shown (and only meaningful) for marketing email.
  const unsub =
    category === "marketing" && footer.unsubscribeUrl
      ? `<p style="margin:10px 0 0;"><a href="${escapeHtml(
          footer.unsubscribeUrl,
        )}" target="_blank" style="color:#94a3b8;text-decoration:underline;">Unsubscribe</a></p>`
      : "";

  return `
    <tr>
      <td align="center" style="padding:24px 32px 32px;border-top:1px solid #e2e8f0;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#94a3b8;">
          ${contactLine}
          ${legal.length ? `<p style="margin:0;">${legal.join(" &nbsp;·&nbsp; ")}</p>` : ""}
          ${unsub}
        </div>
      </td>
    </tr>`;
}

/**
 * Wrap a body fragment in the full, responsive email document. `previewText`
 * is the hidden inbox-preview snippet shown next to the subject in most clients.
 */
export function renderLayout(opts: {
  ctx: RenderContext;
  bodyHtml: string;
  previewText: string;
}): string {
  const { ctx, bodyHtml, previewText } = opts;
  const listUnsub =
    ctx.category === "marketing" && ctx.footer.unsubscribeUrl
      ? `<${ctx.footer.unsubscribeUrl}>`
      : "";
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  ${listUnsub ? `<!-- List-Unsubscribe: ${escapeHtml(listUnsub)} -->` : ""}
  <title>${escapeHtml(ctx.brand.brandName)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(previewText)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="${CONTAINER_WIDTH}" cellpadding="0" cellspacing="0"
               style="width:100%;max-width:${CONTAINER_WIDTH}px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.08);">
          ${headerHtml(ctx.brand)}
          <tr>
            <td style="padding:12px 32px 8px;">
              ${bodyHtml}
            </td>
          </tr>
          ${footerHtml(ctx)}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Build the plain-text counterpart of an email (accessibility + deliverability). */
export function renderTextLayout(opts: {
  ctx: RenderContext;
  bodyText: string;
}): string {
  const { ctx, bodyText } = opts;
  const lines: string[] = [ctx.brand.brandName.toUpperCase(), "", bodyText.trim(), ""];
  lines.push("—");
  if (ctx.footer.supportEmail) lines.push(`Questions? ${ctx.footer.supportEmail}`);
  if (ctx.footer.supportUrl) lines.push(`Help center: ${ctx.footer.supportUrl}`);
  if (ctx.footer.footerText) lines.push(ctx.footer.footerText);
  if (ctx.footer.physicalAddress) lines.push(ctx.footer.physicalAddress);
  if (ctx.category === "marketing" && ctx.footer.unsubscribeUrl) {
    lines.push(`Unsubscribe: ${ctx.footer.unsubscribeUrl}`);
  }
  return lines.join("\n");
}
