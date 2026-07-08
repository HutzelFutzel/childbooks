/**
 * The individual system-email bodies ("code templates").
 *
 * Each function takes its typed vars + the {@link RenderContext} (brand + footer)
 * and returns a {@link RenderedEmail}. Bodies are composed from the shared
 * helpers in `layout.ts`, so every email inherits the same header, footer,
 * colors and responsive shell. Keep copy warm, short, and specific.
 */
import {
  applyTokens,
  button,
  calloutBox,
  escapeHtml,
  heading,
  paragraph,
  renderLayout,
  renderTextLayout,
} from "./layout";
import type { EmailTemplateVarsMap, RenderContext, RenderedEmail } from "./types";

/** A render function for a specific template id. */
export type TemplateRenderer<Id extends keyof EmailTemplateVarsMap> = (
  vars: EmailTemplateVarsMap[Id],
  ctx: RenderContext,
) => RenderedEmail;

function greeting(name?: string): string {
  return name && name.trim() ? `Hi ${escapeHtml(name.trim())},` : "Hi there,";
}

function assemble(
  ctx: RenderContext,
  subject: string,
  previewText: string,
  bodyHtml: string,
  bodyText: string,
): RenderedEmail {
  return {
    subject,
    html: renderLayout({ ctx, bodyHtml, previewText }),
    text: renderTextLayout({ ctx, bodyText }),
  };
}

function sparks(n: number): string {
  return `${n.toLocaleString("en-US")} Spark${n === 1 ? "" : "s"}`;
}

export const RENDERERS: { [Id in keyof EmailTemplateVarsMap]: TemplateRenderer<Id> } = {
  welcome: (vars, ctx) => {
    const subject = `Welcome to ${ctx.brand.brandName}!`;
    const body = [
      heading(`Welcome to ${ctx.brand.brandName}`, ctx.brand),
      paragraph(`${greeting(vars.name)} we're so glad you're here.`),
      paragraph(
        `${escapeHtml(
          ctx.brand.brandName,
        )} lets you write, illustrate, and print your own children's picture books with AI — consistent characters, beautiful layouts, and a real book shipped to your door.`,
      ),
      button("Start your first book", `${ctx.brand.siteUrl}/studio`, ctx.brand),
    ].join("\n");
    const text = `${greeting(vars.name)}\n\nWelcome to ${ctx.brand.brandName}! Start your first book: ${ctx.brand.siteUrl}/studio`;
    return assemble(ctx, subject, `Welcome to ${ctx.brand.brandName}`, body, text);
  },

  order_confirmation: (vars, ctx) => {
    const subject = `Your ${ctx.brand.brandName} order is confirmed`;
    const orderUrl = vars.orderUrl ?? `${ctx.brand.siteUrl}/studio`;
    const body = [
      heading("Your order is confirmed", ctx.brand),
      paragraph(`${greeting(vars.name)} thank you for your order — it's being prepared for printing.`),
      calloutBox(
        `<strong>${escapeHtml(vars.itemLabel)}</strong><br/>Order reference: <strong>${escapeHtml(
          vars.orderRef,
        )}</strong>`,
        ctx.brand,
      ),
      paragraph("We'll email you again as soon as it ships."),
      button("View your order", orderUrl, ctx.brand),
    ].join("\n");
    const text = `${greeting(vars.name)}\n\nYour order is confirmed.\n${vars.itemLabel}\nOrder reference: ${vars.orderRef}\n\nView your order: ${orderUrl}`;
    return assemble(ctx, subject, "Your order is confirmed", body, text);
  },

  order_shipped: (vars, ctx) => {
    const subject = `Your ${ctx.brand.brandName} book is on its way`;
    const track = vars.trackingUrl
      ? button("Track your shipment", vars.trackingUrl, ctx.brand)
      : "";
    const body = [
      heading("Your book has shipped!", ctx.brand),
      paragraph(`${greeting(vars.name)} great news — order ${escapeHtml(vars.orderRef)} is on its way.`),
      vars.carrier ? paragraph(`Carrier: <strong>${escapeHtml(vars.carrier)}</strong>`) : "",
      track,
    ]
      .filter(Boolean)
      .join("\n");
    const text = `${greeting(vars.name)}\n\nOrder ${vars.orderRef} has shipped.${
      vars.carrier ? `\nCarrier: ${vars.carrier}` : ""
    }${vars.trackingUrl ? `\nTrack it: ${vars.trackingUrl}` : ""}`;
    return assemble(ctx, subject, "Your book has shipped", body, text);
  },

  order_failed: (vars, ctx) => {
    const subject = `We hit a snag with your ${ctx.brand.brandName} order`;
    const body = [
      heading("We're looking into your order", ctx.brand),
      paragraph(
        `${greeting(
          vars.name,
        )} we ran into a problem while sending order ${escapeHtml(vars.orderRef)} to print. No action is needed from you — our team has been notified and is on it.`,
      ),
      paragraph(
        `If you have any questions in the meantime, just reply to this email and we'll help right away.`,
      ),
    ].join("\n");
    const text = `${greeting(vars.name)}\n\nWe hit a problem sending order ${vars.orderRef} to print. No action needed — our team is on it. Reply anytime with questions.`;
    return assemble(ctx, subject, "We're looking into your order", body, text);
  },

  subscription_started: (vars, ctx) => {
    const subject = `You're subscribed to ${vars.planName}`;
    const manageUrl = vars.manageUrl ?? `${ctx.brand.siteUrl}/studio`;
    const body = [
      heading(`Welcome to ${escapeHtml(vars.planName)}`, ctx.brand),
      paragraph(`${greeting(vars.name)} your subscription is active — thank you for your support!`),
      vars.sparks
        ? calloutBox(`Your plan includes <strong>${sparks(vars.sparks)}</strong> each month.`, ctx.brand)
        : "",
      button("Go to the studio", manageUrl, ctx.brand),
    ]
      .filter(Boolean)
      .join("\n");
    const text = `${greeting(vars.name)}\n\nYou're subscribed to ${vars.planName}.${
      vars.sparks ? `\nIncludes ${sparks(vars.sparks)} each month.` : ""
    }\n\nStudio: ${manageUrl}`;
    return assemble(ctx, subject, `Welcome to ${vars.planName}`, body, text);
  },

  subscription_cancelled: (vars, ctx) => {
    const subject = `Your ${vars.planName} subscription was cancelled`;
    const body = [
      heading("Your subscription was cancelled", ctx.brand),
      paragraph(
        `${greeting(vars.name)} your ${escapeHtml(vars.planName)} subscription has been cancelled${
          vars.endDate ? ` and will remain active until <strong>${escapeHtml(vars.endDate)}</strong>` : ""
        }.`,
      ),
      paragraph("You can resubscribe anytime — your books and characters are always saved."),
      button("Manage subscription", `${ctx.brand.siteUrl}/studio`, ctx.brand),
    ].join("\n");
    const text = `${greeting(vars.name)}\n\nYour ${vars.planName} subscription was cancelled${
      vars.endDate ? ` and stays active until ${vars.endDate}` : ""
    }. You can resubscribe anytime: ${ctx.brand.siteUrl}/studio`;
    return assemble(ctx, subject, "Your subscription was cancelled", body, text);
  },

  sparks_purchased: (vars, ctx) => {
    const subject = `${sparks(vars.sparks)} added to your account`;
    const body = [
      heading("Your Sparks are ready", ctx.brand),
      paragraph(`${greeting(vars.name)} thanks for your purchase!`),
      calloutBox(
        `<strong>${sparks(vars.sparks)}</strong> have been added to your account.${
          vars.balance != null ? `<br/>New balance: <strong>${sparks(vars.balance)}</strong>` : ""
        }`,
        ctx.brand,
      ),
      button("Start creating", `${ctx.brand.siteUrl}/studio`, ctx.brand),
    ].join("\n");
    const text = `${greeting(vars.name)}\n\n${sparks(vars.sparks)} added to your account.${
      vars.balance != null ? `\nNew balance: ${sparks(vars.balance)}` : ""
    }\n\nStudio: ${ctx.brand.siteUrl}/studio`;
    return assemble(ctx, subject, "Your Sparks are ready", body, text);
  },

  gift_purchased: (vars, ctx) => {
    const subject = `Your ${ctx.brand.brandName} gift is ready to share`;
    const body = [
      heading("Your gift is ready", ctx.brand),
      paragraph(`${greeting(vars.name)} thank you — your gift of <strong>${sparks(vars.sparks)}</strong> is ready.`),
      calloutBox(
        `Gift code:<br/><span style="font-size:20px;font-weight:700;letter-spacing:2px;color:${escapeHtml(
          ctx.brand.primaryColor,
        )};">${escapeHtml(vars.code)}</span>`,
        ctx.brand,
      ),
      paragraph(
        vars.recipientEmail
          ? `We've let ${escapeHtml(vars.recipientEmail)} know too. They can redeem the code above anytime.`
          : `Share the code above with your recipient — they can redeem it anytime.`,
      ),
    ].join("\n");
    const text = `${greeting(vars.name)}\n\nYour gift of ${sparks(vars.sparks)} is ready.\nGift code: ${vars.code}\n\nShare the code with your recipient — they can redeem it anytime.`;
    return assemble(ctx, subject, "Your gift is ready to share", body, text);
  },

  gift_received: (vars, ctx) => {
    const from = vars.senderName ? escapeHtml(vars.senderName) : "Someone";
    const subject = `${from} sent you a gift on ${ctx.brand.brandName}`;
    const claimUrl = vars.claimUrl ?? `${ctx.brand.siteUrl}/studio`;
    const body = [
      heading("You've received a gift!", ctx.brand),
      paragraph(`${from} has sent you <strong>${sparks(vars.sparks)}</strong> to create your own picture book.`),
      vars.message
        ? calloutBox(`"${escapeHtml(vars.message)}"`, ctx.brand)
        : "",
      calloutBox(
        `Your gift code:<br/><span style="font-size:20px;font-weight:700;letter-spacing:2px;color:${escapeHtml(
          ctx.brand.primaryColor,
        )};">${escapeHtml(vars.code)}</span>`,
        ctx.brand,
      ),
      button("Redeem your gift", claimUrl, ctx.brand),
    ]
      .filter(Boolean)
      .join("\n");
    const text = `${from} sent you ${sparks(vars.sparks)} on ${ctx.brand.brandName}!${
      vars.message ? `\n\n"${vars.message}"` : ""
    }\n\nYour gift code: ${vars.code}\nRedeem it: ${claimUrl}`;
    return assemble(ctx, subject, `${from} sent you a gift`, body, text);
  },

  gift_claimed: (vars, ctx) => {
    const subject = `You redeemed ${sparks(vars.sparks)}`;
    const body = [
      heading("Gift redeemed!", ctx.brand),
      paragraph(`${greeting(vars.name)} your gift has been added to your account.`),
      calloutBox(
        `<strong>${sparks(vars.sparks)}</strong> added.${
          vars.balance != null ? `<br/>New balance: <strong>${sparks(vars.balance)}</strong>` : ""
        }`,
        ctx.brand,
      ),
      button("Start creating", `${ctx.brand.siteUrl}/studio`, ctx.brand),
    ].join("\n");
    const text = `${greeting(vars.name)}\n\nGift redeemed — ${sparks(vars.sparks)} added.${
      vars.balance != null ? `\nNew balance: ${sparks(vars.balance)}` : ""
    }\n\nStudio: ${ctx.brand.siteUrl}/studio`;
    return assemble(ctx, subject, "Gift redeemed", body, text);
  },

  referral_reward: (vars, ctx) => {
    const subject = `You earned ${sparks(vars.sparks)}`;
    const reason =
      vars.kind === "referrer"
        ? "Someone you invited just made their first purchase — thank you for spreading the word!"
        : "Welcome! Here's a little something to get you started, thanks to your friend's invite.";
    const body = [
      heading("You earned Sparks!", ctx.brand),
      paragraph(`${greeting(vars.name)} ${reason}`),
      calloutBox(`<strong>${sparks(vars.sparks)}</strong> have been added to your account.`, ctx.brand),
      button("Start creating", `${ctx.brand.siteUrl}/studio`, ctx.brand),
    ].join("\n");
    const text = `${greeting(vars.name)}\n\n${reason}\n${sparks(vars.sparks)} added to your account.\n\nStudio: ${ctx.brand.siteUrl}/studio`;
    return assemble(ctx, subject, "You earned Sparks", body, text);
  },
};

/** Re-export for callers that only need the token helper (subject overrides). */
export { applyTokens };
