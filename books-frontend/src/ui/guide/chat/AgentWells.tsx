"use client";

/**
 * Wells for things the reader asked the chat to do: a confirmation card that
 * says exactly what changes, the options for a missing detail, the missing
 * step behind a request, and the Sparks packs. Every word here is trusted,
 * localized UI copy — the card lists the impact the code computed, never a
 * model's description of it.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { CommandArgs, ImpactEffect } from "../../../core/guide/agent/types";
import { packTotalSparks } from "../../../core/config/sparks";
import { formatMoney } from "../../../core/i18n/format";
import type { BookViewId } from "../../../core/guide/journey";
import { buySparkPack } from "../../../platform/payments";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAuthStore } from "../../../state/authStore";
import { useChatStudio } from "../../../state/chatStudio";
import type { AgentWell } from "../../../state/guideAgent";
import { useProjectsStore } from "../../../state/projectsStore";
import { useSparksUiStore } from "../../../state/sparksUiStore";
import { cn } from "../../lib/cn";
import { useGuideLabel, useGuideT } from "../intl";

export type AgentWellItem = Extract<AgentWell, { kind: "agentConfirm" | "agentAsk" | "agentBlocked" | "sparksOffer" }>;

export function isAgentWellItem(well: { kind: string }): well is AgentWellItem {
  return ["agentConfirm", "agentAsk", "agentBlocked", "sparksOffer"].includes(well.kind);
}

function Choice({
  onClick,
  children,
  subtle,
  primary,
  disabled,
  onDefault,
}: {
  onClick: () => void;
  children: React.ReactNode;
  subtle?: boolean;
  /** The committing choice on a confirmation card. Never coral: that color is reserved for spending. */
  primary?: boolean;
  disabled?: boolean;
  onDefault?: (run: (() => void) | null) => void;
}) {
  const latest = useRef(onClick);
  latest.current = onClick;
  useEffect(() => {
    if (!onDefault) return;
    onDefault(() => latest.current());
    return () => onDefault(null);
  }, [onDefault]);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2 disabled:opacity-60",
        subtle
          ? "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
          : primary
            ? "bg-ink-900 text-white shadow-soft hover:bg-ink-800"
            : "bg-white text-ink-900 ring-1 ring-ink-200 shadow-soft hover:ring-ink-400",
      )}
    >
      {children}
    </button>
  );
}

function ImpactLine({ effect }: { effect: ImpactEffect }) {
  const t = useGuideT("agent");
  switch (effect.kind) {
    case "removesPerson":
      return (
        <>
          <li>{t("impactRemovesPerson", { name: effect.name })}</li>
          {effect.hasPortrait && <li>{t("impactPortraitKept", { name: effect.name })}</li>}
        </>
      );
    case "storyMentions":
      return <li>{t("impactStoryMentions", { name: effect.name, count: effect.count })}</li>;
    case "deletesPhoto":
      return <li>{t("impactDeletesPhoto", { name: effect.name })}</li>;
    case "replacesStory":
      return <li>{t("impactReplacesStory", { words: effect.words })}</li>;
    case "renamesInStory":
      return <li>{t("impactRenamesInStory", { from: effect.from, to: effect.to, count: effect.count })}</li>;
    case "outdatesPortraits":
      return <li>{t("impactOutdatesPortraits", { names: effect.names.join(", ") })}</li>;
    case "removesPlace":
      return <li>{t("impactRemovesPlace", { name: effect.name })}</li>;
  }
}

export function agentWellTitle(well: AgentWellItem, t: ReturnType<typeof useGuideT>): string {
  switch (well.kind) {
    case "agentConfirm":
      return t("taskConfirm");
    case "agentAsk":
      return t("taskChoose");
    case "sparksOffer":
      return t("taskSparks");
    case "agentBlocked":
      return "";
  }
}

export function AgentWellBody({
  well,
  onView,
  onDefault,
}: {
  well: AgentWellItem;
  onView: (view: BookViewId) => void;
  onDefault: (run: (() => void) | null) => void;
}) {
  switch (well.kind) {
    case "agentConfirm":
      return <ConfirmCard well={well} onDefault={onDefault} />;
    case "agentAsk":
      return <AskOptions well={well} onView={onView} />;
    case "agentBlocked":
      return <BlockedRemedy well={well} onView={onView} onDefault={onDefault} />;
    case "sparksOffer":
      return <SparksOffer />;
  }
}

function ConfirmCard({
  well,
  onDefault,
}: {
  well: Extract<AgentWell, { kind: "agentConfirm" }>;
  onDefault: (run: (() => void) | null) => void;
}) {
  const t = useGuideT("agent");
  const label = useGuideLabel();
  const confirm = useChatStudio((s) => s.confirmAgent);
  const cancel = useChatStudio((s) => s.cancelAgent);
  const tap = useChatStudio((s) => s.tap);
  const sending = useChatStudio((s) => s.sending);
  const { impact, choices, expiresAt } = well.confirm;
  const confirmAgent = (args: CommandArgs | null, text: string) => void tap(text, () => confirm(args));
  const cancelAgent = () => void tap(label("cancel"), async () => cancel());
  const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
  return (
    <div className="flex w-full flex-col items-start gap-3">
      {impact.effects.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm leading-snug text-ink-700">
          {impact.effects.map((effect, index) => (
            <ImpactLine key={`${effect.kind}:${index}`} effect={effect} />
          ))}
          {impact.level === "irreversible" && <li className="font-medium text-ink-900">{t("cannotUndo")}</li>}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {choices ? (
          choices.map((choice, index) => (
            <Choice
              key={choice.label}
              disabled={sending}
              primary={index === 0}
              onClick={() => confirmAgent(choice.args, label(choice.label))}
            >
              {label(choice.label)}
            </Choice>
          ))
        ) : (
          <Choice
            disabled={sending}
            primary
            onClick={() => confirmAgent(null, label(impact.level === "irreversible" ? "deletePhoto" : "confirmYes"))}
            onDefault={impact.level === "irreversible" ? undefined : onDefault}
          >
            {label(impact.level === "irreversible" ? "deletePhoto" : "confirmYes")}
          </Choice>
        )}
        <Choice subtle onClick={cancelAgent}>
          {label("cancel")}
        </Choice>
      </div>
      <p className="text-xs text-ink-500">{t("expires", { minutes })}</p>
    </div>
  );
}

function AskOptions({
  well,
  onView,
}: {
  well: Extract<AgentWell, { kind: "agentAsk" }>;
  onView: (view: BookViewId) => void;
}) {
  const t = useGuideT("agent");
  const answer = useChatStudio((s) => s.answerAgentAsk);
  const sending = useChatStudio((s) => s.sending);
  return (
    <div className="flex flex-wrap gap-2">
      {well.options.map((option) => (
        <Choice key={option.id} disabled={sending} onClick={() => void answer(option)}>
          {option.label}
        </Choice>
      ))}
      {well.arg === "style" && (
        <Choice subtle onClick={() => onView("style")}>
          {t("remedyShow")}
        </Choice>
      )}
    </div>
  );
}

function BlockedRemedy({
  well,
  onView,
  onDefault,
}: {
  well: Extract<AgentWell, { kind: "agentBlocked" }>;
  onView: (view: BookViewId) => void;
  onDefault: (run: (() => void) | null) => void;
}) {
  const t = useGuideT("agent");
  const label = useGuideLabel();
  const runSkill = useChatStudio((s) => s.runSkill);
  const tap = useChatStudio((s) => s.tap);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);
  const { remedy } = well;
  if (remedy.command === "offerSparks") return <SparksOffer />;
  return (
    <div className="flex flex-wrap gap-2">
      {remedy.command === "signIn" ? (
        <Choice onClick={() => openAuthDialog("drawBook")} onDefault={onDefault}>
          {label("createAccount")}
        </Choice>
      ) : remedy.command === "drawPortraits" ? (
        <Choice
          onClick={() => void tap(t("remedyPortraits"), () => runSkill({ id: "drawPortraits", args: {} }))}
          onDefault={onDefault}
        >
          {t("remedyPortraits")}
        </Choice>
      ) : remedy.view ? (
        <Choice onClick={() => onView(remedy.view!)} onDefault={onDefault}>
          {t("remedyShow")}
        </Choice>
      ) : null}
    </div>
  );
}

function SparksOffer() {
  const t = useGuideT("agent");
  const label = useGuideLabel();
  const packs = useAppConfigStore((s) => s.sparks.packs);
  const currency = useAppConfigStore((s) => s.pricingSettings.baseCurrency);
  const projectId = useProjectsStore((s) => s.currentId);
  const openWallet = useSparksUiStore((s) => s.openWallet);
  const [busy, setBusy] = useState<string | null>(null);
  const active = [...packs].filter((p) => p.active).sort((a, b) => packTotalSparks(a) - packTotalSparks(b)).slice(0, 3);
  const buy = async (packId: string) => {
    setBusy(packId);
    try {
      const { url } = await buySparkPack(packId, currency, undefined, projectId ?? undefined);
      window.location.href = url;
    } catch {
      setBusy(null);
    }
  };
  if (active.length === 0) {
    return <p className="px-1 text-sm text-ink-600">{t("noPacks")}</p>;
  }
  return (
    <div className="flex w-full flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {active.map((pack) => {
          const price = pack.prices[currency];
          return (
            <Choice key={pack.id} disabled={busy !== null} onClick={() => void buy(pack.id)}>
              {busy === pack.id && <Loader2 className="size-4 animate-spin" />}
              {label("buyPack")} · {packTotalSparks(pack)} Sparks
              {typeof price === "number" && (
                <span className="font-normal text-ink-500">· {formatMoney(navigator.language, price, currency)}</span>
              )}
            </Choice>
          );
        })}
      </div>
      <Choice subtle onClick={() => openWallet()}>
        {t("seeAllPacks")}
      </Choice>
    </div>
  );
}
