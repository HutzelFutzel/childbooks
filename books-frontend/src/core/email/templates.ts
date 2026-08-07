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
    // When a verification link is supplied (email/password signups), the primary
    // CTA verifies the address — clicking it confirms the account and unlocks
    // ordering + the verify bonus. Verified identities (e.g. Google) get the
    // plain "start creating" CTA instead.
    const cta = vars.verifyUrl
      ? button("Verify your email", vars.verifyUrl, ctx.brand)
      : button("Start your first book", `${ctx.brand.siteUrl}/studio`, ctx.brand);
    const body = [
      heading(`Welcome to ${ctx.brand.brandName}`, ctx.brand),
      paragraph(`${greeting(vars.name)} we're so glad you're here.`),
      paragraph(
        `${escapeHtml(
          ctx.brand.brandName,
        )} lets you write, illustrate, and print your own children's picture books with AI — consistent characters, beautiful layouts, and a real book shipped to your door.`,
      ),
      vars.verifyUrl
        ? paragraph("First, please confirm your email address so we know it's really you:")
        : "",
      cta,
    ]
      .filter(Boolean)
      .join("\n");
    const text = vars.verifyUrl
      ? `${greeting(vars.name)}\n\nWelcome to ${ctx.brand.brandName}! Please confirm your email address to get started: ${vars.verifyUrl}`
      : `${greeting(vars.name)}\n\nWelcome to ${ctx.brand.brandName}! Start your first book: ${ctx.brand.siteUrl}/studio`;
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

  referral_invite: (vars, ctx) => {
    const from = vars.inviterName ? escapeHtml(vars.inviterName) : "A friend";
    const subject = `${from} invited you to make a picture book`;
    const body = [
      heading("You've been invited", ctx.brand),
      paragraph(
        `${from} thinks you'd love ${escapeHtml(ctx.brand.brandName)} — write, illustrate and print your own ` +
          `children's picture book, with characters that stay themselves from page to page.`,
      ),
      vars.message ? calloutBox(`"${escapeHtml(vars.message)}"`, ctx.brand) : "",
      vars.benefit
        ? calloutBox(`Your welcome gift: <strong>${escapeHtml(vars.benefit)}</strong>.`, ctx.brand)
        : "",
      button("Accept the invitation", vars.acceptUrl, ctx.brand),
      vars.expiresOn ? paragraph(`This invitation is good until ${escapeHtml(vars.expiresOn)}.`) : "",
      // The decline link is the whole compliance story for an email to someone
      // who never signed up: one click and we never write to them again.
      paragraph(
        `Not interested? <a href="${escapeHtml(vars.declineUrl)}" style="color:#64748b;">Decline this invitation</a> ` +
          `and we won't email you about ${escapeHtml(ctx.brand.brandName)} again.`,
      ),
    ]
      .filter(Boolean)
      .join("\n");
    const text = [
      `${vars.inviterName ?? "A friend"} invited you to make a picture book on ${ctx.brand.brandName}.`,
      vars.message ? `\n"${vars.message}"` : "",
      vars.benefit ? `\nYour welcome gift: ${vars.benefit}.` : "",
      `\nAccept: ${vars.acceptUrl}`,
      vars.expiresOn ? `This invitation is good until ${vars.expiresOn}.` : "",
      `\nNot interested? Decline (and never hear from us again): ${vars.declineUrl}`,
    ]
      .filter(Boolean)
      .join("\n");
    return assemble(ctx, subject, `${vars.inviterName ?? "A friend"} invited you`, body, text);
  },

  referral_invite_sent: (vars, ctx) => {
    const subject = `Your invitation to ${vars.recipientEmail} is on its way`;
    const body = [
      heading("Invitation sent", ctx.brand),
      paragraph(`${greeting(vars.name)} we've emailed your invitation to ${escapeHtml(vars.recipientEmail)}.`),
      vars.benefit
        ? calloutBox(`Your reward: <strong>${escapeHtml(vars.benefit)}</strong>.`, ctx.brand)
        : "",
      paragraph("You can also share your personal link with anyone else — it works the same way:"),
      calloutBox(`<span style="word-break:break-all;">${escapeHtml(vars.inviteUrl)}</span>`, ctx.brand),
    ]
      .filter(Boolean)
      .join("\n");
    const text = `${greeting(vars.name)}\n\nYour invitation to ${vars.recipientEmail} is on its way.${
      vars.benefit ? `\nYour reward: ${vars.benefit}.` : ""
    }\n\nYour personal link: ${vars.inviteUrl}`;
    return assemble(ctx, subject, "Invitation sent", body, text);
  },

  referral_invite_accepted: (vars, ctx) => {
    const who = vars.friendName ? escapeHtml(vars.friendName) : "Someone you invited";
    const subject = `${vars.friendName ?? "Your friend"} joined ${ctx.brand.brandName}`;
    const body = [
      heading("Your friend joined!", ctx.brand),
      paragraph(`${greeting(vars.name)} ${who} accepted your invitation — lovely.`),
      vars.benefit
        ? calloutBox(
            `<strong>${escapeHtml(vars.benefit)}</strong>${
              vars.pending ? ` — it lands after ${escapeHtml(vars.pending)}.` : "."
            }`,
            ctx.brand,
          )
        : "",
      button("Invite someone else", `${ctx.brand.siteUrl}/studio?invite=1`, ctx.brand),
    ]
      .filter(Boolean)
      .join("\n");
    const text = `${greeting(vars.name)}\n\n${vars.friendName ?? "Someone you invited"} accepted your invitation.${
      vars.benefit ? `\n${vars.benefit}${vars.pending ? ` — it lands after ${vars.pending}.` : "."}` : ""
    }\n\nInvite someone else: ${ctx.brand.siteUrl}/studio?invite=1`;
    return assemble(ctx, subject, "Your friend joined", body, text);
  },

  referral_reminder: (vars, ctx) => {
    const from = vars.inviterName ? escapeHtml(vars.inviterName) : "A friend";
    const subject = `Still time to accept ${vars.inviterName ?? "your friend"}'s invitation`;
    const body = [
      heading("Your invitation is still open", ctx.brand),
      paragraph(`${from} invited you to make a picture book on ${escapeHtml(ctx.brand.brandName)}.`),
      vars.benefit ? calloutBox(`Your welcome gift: <strong>${escapeHtml(vars.benefit)}</strong>.`, ctx.brand) : "",
      button("Accept the invitation", vars.acceptUrl, ctx.brand),
      vars.expiresOn ? paragraph(`After ${escapeHtml(vars.expiresOn)} the invitation expires.`) : "",
      paragraph(
        `This is the only reminder we'll send. You can also ` +
          `<a href="${escapeHtml(vars.declineUrl)}" style="color:#64748b;">decline</a> to hear nothing further.`,
      ),
    ]
      .filter(Boolean)
      .join("\n");
    const text = [
      `${vars.inviterName ?? "A friend"} invited you to make a picture book on ${ctx.brand.brandName}.`,
      vars.benefit ? `Your welcome gift: ${vars.benefit}.` : "",
      `Accept: ${vars.acceptUrl}`,
      vars.expiresOn ? `After ${vars.expiresOn} the invitation expires.` : "",
      `This is the only reminder we'll send. Decline: ${vars.declineUrl}`,
    ]
      .filter(Boolean)
      .join("\n");
    return assemble(ctx, subject, "Your invitation is still open", body, text);
  },

  referral_reward: (vars, ctx) => {
    const subject = `You earned ${vars.benefit}`;
    const reason =
      vars.kind === "referrer"
        ? "Someone you invited hit a milestone — thank you for spreading the word!"
        : "Welcome! Here's the reward from your friend's invitation.";
    const body = [
      heading("Your reward is here", ctx.brand),
      paragraph(`${greeting(vars.name)} ${reason}`),
      calloutBox(
        `<strong>${escapeHtml(vars.benefit)}</strong>${
          vars.balance != null ? `<br/>New balance: <strong>${sparks(vars.balance)}</strong>` : ""
        }`,
        ctx.brand,
      ),
      vars.howToUse ? paragraph(escapeHtml(vars.howToUse)) : "",
      button("Start creating", `${ctx.brand.siteUrl}/studio`, ctx.brand),
    ]
      .filter(Boolean)
      .join("\n");
    const text = `${greeting(vars.name)}\n\n${reason}\n${vars.benefit}${
      vars.balance != null ? `\nNew balance: ${sparks(vars.balance)}` : ""
    }${vars.howToUse ? `\n${vars.howToUse}` : ""}\n\nStudio: ${ctx.brand.siteUrl}/studio`;
    return assemble(ctx, subject, "Your reward is here", body, text);
  },

  contact_form: (vars, ctx) => {
    const topic = vars.topic?.trim();
    const subject = topic
      ? `Contact form: ${topic}`
      : `New contact form message from ${vars.fromName}`;
    const body = [
      heading("New contact form message", ctx.brand),
      paragraph(
        `<strong>From:</strong> ${escapeHtml(vars.fromName)} &lt;${escapeHtml(vars.fromEmail)}&gt;`,
      ),
      topic ? paragraph(`<strong>Topic:</strong> ${escapeHtml(topic)}`) : "",
      calloutBox(escapeHtml(vars.message).replace(/\n/g, "<br/>"), ctx.brand),
      paragraph("Just reply to this email to respond — it goes straight to the sender."),
    ]
      .filter(Boolean)
      .join("\n");
    const text = `New contact form message\n\nFrom: ${vars.fromName} <${vars.fromEmail}>${
      topic ? `\nTopic: ${topic}` : ""
    }\n\n${vars.message}\n\nReply to this email to respond.`;
    return assemble(ctx, subject, "New contact form message", body, text);
  },

  contact_form_ack: (vars, ctx) => {
    const subject = `We got your message · ${vars.ref}`;
    const replyLine =
      "We try to reply within 24 hours, but it can occasionally take a little longer — thanks for your patience.";
    const body = [
      heading("We got your message", ctx.brand),
      paragraph(
        `${greeting(vars.name)} thanks for reaching out${
          vars.topic ? ` about <strong>${escapeHtml(vars.topic)}</strong>` : ""
        }. ${replyLine}`,
      ),
      calloutBox(escapeHtml(vars.message).replace(/\n/g, "<br/>"), ctx.brand),
      paragraph(
        `Your reference: <strong style="font-family:monospace;">${escapeHtml(vars.ref)}</strong> — mention it if you follow up and we'll find your message right away.`,
      ),
    ].join("\n");
    const text = `${greeting(vars.name)}\n\nThanks for reaching out${
      vars.topic ? ` about ${vars.topic}` : ""
    }. ${replyLine}\n\nYour message:\n${vars.message}\n\nYour reference: ${vars.ref}\nMention it if you follow up and we'll find your message right away.`;
    return assemble(ctx, subject, `We got your message · ${vars.ref}`, body, text);
  },

  affiliate_application_ack: (vars, ctx) => {
    const subject = `We received your affiliate application · ${vars.ref}`;
    const reviewLine =
      "We review every application by hand to keep the program a good fit for families and creators. We'll email you with next steps — usually within a few business days.";
    const body = [
      heading("Application received", ctx.brand),
      paragraph(`${greeting(vars.name)} thanks for applying to the ${escapeHtml(ctx.brand.brandName)} affiliate program. ${reviewLine}`),
      calloutBox(
        [
          `<strong>Channel:</strong> ${escapeHtml(vars.channel)}`,
          `<strong>Audience:</strong> ${escapeHtml(vars.audience)}`,
          `<strong>URL:</strong> ${escapeHtml(vars.channelUrl)}`,
          "",
          escapeHtml(vars.pitch).replace(/\n/g, "<br/>"),
        ].join("<br/>"),
        ctx.brand,
      ),
      paragraph(
        `Your reference: <strong style="font-family:monospace;">${escapeHtml(vars.ref)}</strong> — mention it if you follow up.`,
      ),
    ].join("\n");
    const text = `${greeting(vars.name)}\n\nThanks for applying to the ${ctx.brand.brandName} affiliate program. ${reviewLine}\n\nChannel: ${vars.channel}\nAudience: ${vars.audience}\nURL: ${vars.channelUrl}\n\n${vars.pitch}\n\nYour reference: ${vars.ref}`;
    return assemble(ctx, subject, `Affiliate application received · ${vars.ref}`, body, text);
  },

  policy_update: (vars, ctx) => {
    const subject = `We've updated our ${vars.policyName}`;
    const body = [
      heading(`Our ${escapeHtml(vars.policyName)} has changed`, ctx.brand),
      paragraph(
        `${greeting(vars.name)} we're letting you know that we've updated our ${escapeHtml(
          vars.policyName,
        )}${
          vars.effectiveDate ? `, effective <strong>${escapeHtml(vars.effectiveDate)}</strong>` : ""
        }.`,
      ),
      paragraph(
        "Please take a moment to review the changes. By continuing to use your account you accept the updated terms.",
      ),
      button(`Read the updated ${vars.policyName}`, vars.documentUrl, ctx.brand),
    ].join("\n");
    const text = `${greeting(vars.name)}\n\nWe've updated our ${vars.policyName}${
      vars.effectiveDate ? `, effective ${vars.effectiveDate}` : ""
    }.\n\nRead it here: ${vars.documentUrl}`;
    return assemble(ctx, subject, `Our ${vars.policyName} has changed`, body, text);
  },

  admin_invite: (vars, ctx) => {
    const subject = `You've been invited to the ${ctx.brand.brandName} dashboard`;
    const body = [
      heading("You've been invited", ctx.brand),
      paragraph(
        `${
          vars.inviterName ? `${escapeHtml(vars.inviterName)} has` : "You've been"
        } invited you to help run the ${escapeHtml(ctx.brand.brandName)} admin dashboard. Set a password to get started — you'll land with the access they've granted you.`,
      ),
      button("Set your password", vars.setPasswordUrl, ctx.brand),
      paragraph("Didn't expect this? You can safely ignore this email."),
    ].join("\n");
    const text = `${
      vars.inviterName ? `${vars.inviterName} has` : "You've been"
    } invited you to help run the ${ctx.brand.brandName} admin dashboard.\n\nSet your password: ${vars.setPasswordUrl}\n\nDidn't expect this? You can safely ignore this email.`;
    return assemble(ctx, subject, "You've been invited to the admin dashboard", body, text);
  },
};

/** Re-export for callers that only need the token helper (subject overrides). */
export { applyTokens };
