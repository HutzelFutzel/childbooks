"use client";

/**
 * "Invite friends" — the referral program's whole user-facing surface.
 *
 * Three things, in the order someone actually needs them:
 *
 *   1. **What both sides get**, in the server's own words. The copy is computed
 *      from the configured rules (`referrerSummary` / `referredSummary`), never
 *      written here — so an admin changing a reward changes what the screen
 *      promises, and the two can't drift.
 *   2. **How to invite**: email addresses (we send the invitation and chase it
 *      once), or the personal link for anywhere else.
 *   3. **What happened since**: every invitation with its progress, and every
 *      reward earned — including the promise each invitation was sent under,
 *      which is what makes a changed program comprehensible rather than alarming.
 *
 * Send results are shown per address, honestly ("already a member", "invited
 * recently") because a silent success trains people to send the same invite again.
 */
import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Gift,
  Link2,
  Loader2,
  Mail,
  Users,
  X,
} from "lucide-react";
import {
  fetchReferralOverview,
  sendReferralInvites,
  type InvitationView,
  type ReferralOverview,
  type RewardView,
  type SendResult,
} from "../../platform/referrals";
import { Button } from "../components/Button";
import { Input, Textarea } from "../components/Input";
import { Modal } from "../components/Modal";
import { notify } from "../lib/notify";
import { cn } from "../lib/cn";

const MAX_RECIPIENTS = 10;

export function InviteFriendsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [overview, setOverview] = useState<ReferralOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [emails, setEmails] = useState("");
  const [personalMessage, setPersonalMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchReferralOverview()
      .then(setOverview)
      .catch(() => setOverview(null))
      .finally(() => setLoading(false));
  }, [open]);

  const addresses = parseEmails(emails);
  const tooMany = addresses.length > MAX_RECIPIENTS;

  const send = async () => {
    if (addresses.length === 0 || tooMany) return;
    setSending(true);
    try {
      const res = await sendReferralInvites(addresses, personalMessage.trim() || undefined);
      setResults(res.results);
      const sent = res.results.filter((r) => r.outcome === "sent").length;
      if (sent > 0) {
        notify.success(
          sent === 1 ? "Invitation sent" : `${sent} invitations sent`,
          "We'll let you know the moment they join.",
        );
        setEmails("");
        setPersonalMessage("");
        // Pull the invitation list + remaining allowance back in sync.
        fetchReferralOverview().then(setOverview).catch(() => {});
      }
    } catch (err) {
      notify.error(err);
    } finally {
      setSending(false);
    }
  };

  const copyLink = () => {
    if (!overview) return;
    void navigator.clipboard.writeText(overview.shareUrl).then(
      () => notify.success("Invite link copied", "Paste it anywhere — the reward follows the link."),
      () => notify.error("Could not copy the link."),
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Invite friends" size="max-w-2xl">
      {loading && !overview ? (
        <div className="flex items-center justify-center gap-2 py-12 text-ink-500">
          <Loader2 className="size-5 animate-spin" /> Loading…
        </div>
      ) : !overview ? (
        <p className="py-10 text-center text-sm text-ink-500">
          Invitations aren't available right now. Please try again later.
        </p>
      ) : (
        <div className="-mx-1 max-h-[72vh] space-y-5 overflow-y-auto px-1 py-1">
          <Offer overview={overview} />

          {overview.enabled && (
            <>
              <section className="space-y-2">
                <SectionTitle icon={<Mail className="size-3.5" />}>Invite by email</SectionTitle>
                {overview.canInvite ? (
                  <>
                    <Input
                      value={emails}
                      onChange={(e) => setEmails(e.target.value)}
                      placeholder="friend@example.com, another@example.com"
                      autoComplete="off"
                    />
                    <Textarea
                      value={personalMessage}
                      onChange={(e) => setPersonalMessage(e.target.value.slice(0, 500))}
                      placeholder="Add a note (optional) — invitations with a personal line get opened far more often."
                      rows={2}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-ink-500">
                        {overview.invitationsLeftToday > 0
                          ? `${overview.invitationsLeftToday} invitation${
                              overview.invitationsLeftToday === 1 ? "" : "s"
                            } left today`
                          : "You've used today's invitations — your link keeps working."}
                      </p>
                      <Button
                        size="sm"
                        loading={sending}
                        disabled={addresses.length === 0 || tooMany || overview.invitationsLeftToday === 0}
                        leftIcon={<Mail className="size-4" />}
                        onClick={() => void send()}
                      >
                        {addresses.length > 1 ? `Send ${addresses.length} invitations` : "Send invitation"}
                      </Button>
                    </div>
                    {tooMany && (
                      <p className="text-xs text-red-600">
                        Up to {MAX_RECIPIENTS} addresses at a time, please.
                      </p>
                    )}
                    {results && <SendResults results={results} />}
                  </>
                ) : (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {overview.cannotInviteReason ?? "Invitations aren't available for your account yet."}
                  </p>
                )}
              </section>

              <section className="space-y-2">
                <SectionTitle icon={<Link2 className="size-3.5" />}>Or share your link</SectionTitle>
                <button
                  type="button"
                  onClick={copyLink}
                  className="flex w-full items-center justify-between gap-3 rounded-xl bg-ink-50/70 px-3 py-2.5 text-left transition hover:bg-ink-100"
                >
                  <span className="truncate font-mono text-xs text-ink-600">{overview.shareUrl}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-700">
                    <Copy className="size-3.5" /> Copy
                  </span>
                </button>
              </section>
            </>
          )}

          {overview.invitations.length > 0 && (
            <section className="space-y-2">
              <SectionTitle icon={<Users className="size-3.5" />}>
                Your invitations ({overview.invitations.length})
              </SectionTitle>
              <div className="space-y-2">
                {overview.invitations.map((inv) => (
                  <InvitationRow key={inv.id} invitation={inv} />
                ))}
              </div>
            </section>
          )}

          {overview.rewards.length > 0 && (
            <section className="space-y-2">
              <SectionTitle icon={<Gift className="size-3.5" />}>Your rewards</SectionTitle>
              <div className="space-y-2">
                {overview.rewards.map((reward) => (
                  <RewardRow key={reward.id} reward={reward} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
      {icon}
      {children}
    </div>
  );
}

/** The deal, in the program's own configured words. */
function Offer({ overview }: { overview: ReferralOverview }) {
  if (!overview.enabled) {
    return (
      <div className="rounded-2xl bg-ink-50 p-4 text-sm text-ink-600">
        Our invite programme is paused at the moment. Invitations you've already sent still count.
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-emerald-50 p-4">
      <h3 className="text-base font-semibold text-ink-800">{overview.headline}</h3>
      <p className="mt-1 text-sm text-ink-600">{overview.subline}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {overview.referredSummary && (
          <BenefitCard label="Your friend gets" value={overview.referredSummary} notes={overview.referredNotes} />
        )}
        {overview.referrerSummary && (
          <BenefitCard label="You get" value={overview.referrerSummary} notes={overview.referrerNotes} />
        )}
      </div>
    </div>
  );
}

function BenefitCard({ label, value, notes }: { label: string; value: string; notes?: string[] }) {
  return (
    <div className="rounded-xl bg-white/80 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</div>
      <div className="text-sm font-medium text-ink-800">{value}</div>
      {notes && notes.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {notes.map((note) => (
            <li key={note} className="text-[11px] text-ink-400">
              * {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const OUTCOME_COPY: Record<SendResult["outcome"], { text: string; tone: "ok" | "warn" | "bad" }> = {
  sent: { text: "Invitation sent", tone: "ok" },
  invalid: { text: "That address doesn't look right", tone: "bad" },
  self: { text: "That's your own address", tone: "warn" },
  already_member: { text: "Already has an account", tone: "warn" },
  recently_invited: { text: "Someone invited them recently", tone: "warn" },
  declined: { text: "They asked not to be invited", tone: "warn" },
  limit: { text: "Daily invitation limit reached", tone: "warn" },
  failed: { text: "We couldn't send this one — please try again", tone: "bad" },
};

function SendResults({ results }: { results: SendResult[] }) {
  return (
    <ul className="space-y-1">
      {results.map((r) => {
        const copy = OUTCOME_COPY[r.outcome];
        return (
          <li key={`${r.email}_${r.outcome}`} className="flex items-center gap-2 text-xs">
            {copy.tone === "ok" ? (
              <Check className="size-3.5 shrink-0 text-emerald-600" />
            ) : (
              <X className={cn("size-3.5 shrink-0", copy.tone === "bad" ? "text-red-500" : "text-amber-500")} />
            )}
            <span className="truncate text-ink-700">{r.email}</span>
            <span className="text-ink-400">— {copy.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

const STATUS_COPY: Record<InvitationView["status"], string> = {
  pending: "Waiting for them",
  accepted: "Joined",
  expired: "Expired",
  void: "Withdrawn",
  blocked: "On hold",
};

function InvitationRow({ invitation }: { invitation: InvitationView }) {
  const steps: { label: string; done: boolean }[] = [
    { label: "Joined", done: invitation.progress.signedUp },
    { label: "Confirmed email", done: invitation.progress.verified },
    { label: "Made a book", done: invitation.progress.activated },
    { label: "First purchase", done: invitation.progress.purchased },
  ];
  return (
    <div className="rounded-xl border border-ink-100 bg-white px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-800">
            {invitation.recipientEmail ?? "Shared link"}
          </p>
          {/* The promise this invitation was SENT under — not today's offer. */}
          {invitation.referrerSummary && (
            <p className="mt-0.5 text-xs text-ink-500">You earn {invitation.referrerSummary}</p>
          )}
          {invitation.referrerNotes.length > 0 && (
            <p className="mt-0.5 text-[11px] text-ink-400">* {invitation.referrerNotes.join(" · ")}</p>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            invitation.status === "accepted"
              ? "bg-emerald-50 text-emerald-700"
              : invitation.status === "pending"
                ? "bg-amber-50 text-amber-700"
                : "bg-ink-100 text-ink-500",
          )}
        >
          {STATUS_COPY[invitation.status]}
        </span>
      </div>
      {invitation.status === "accepted" && (
        <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {steps.map((s) => (
            <li
              key={s.label}
              className={cn("flex items-center gap-1 text-[11px]", s.done ? "text-emerald-700" : "text-ink-400")}
            >
              {s.done ? <CheckCircle2 className="size-3" /> : <Clock className="size-3" />}
              {s.label}
            </li>
          ))}
        </ol>
      )}
      {invitation.status === "pending" && invitation.expiresAt > 0 && (
        <p className="mt-1.5 text-[11px] text-ink-400">
          Expires {formatDate(invitation.expiresAt)}
          {invitation.remindersSent > 0 ? " · reminder sent" : ""}
        </p>
      )}
    </div>
  );
}

function RewardRow({ reward }: { reward: RewardView }) {
  const granted = reward.status === "granted";
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-ink-50/60 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-800">{reward.summary}</p>
        <p className="text-xs text-ink-500">
          {granted
            ? reward.used
              ? "Used"
              : reward.expiresAt
                ? `Ready to use — expires ${formatDate(reward.expiresAt)}`
                : "Added to your account"
            : reward.status === "review"
              ? "We're double-checking this one"
              : reward.status === "clawed_back"
                ? "Reversed (the purchase was refunded)"
                : reward.unlocks}
        </p>
      </div>
      <span className="shrink-0 text-[11px] text-ink-400">{formatDate(reward.at)}</span>
    </div>
  );
}

function parseEmails(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function formatDate(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}
