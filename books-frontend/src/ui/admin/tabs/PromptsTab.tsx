"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, RotateCcw } from "lucide-react";
import {
  PROMPT_ACTIONS,
  defaultTemplate,
  type PromptTemplateMeta,
} from "../../../core/prompts/registry";
import type { PromptBlock, PromptSegment, PromptsConfig } from "../../../core/config/prompts";
import { renderSinglePrompt, renderTextPrompt } from "../../../core/prompts/render";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Textarea } from "../../components/Input";
import { Toggle } from "../../components/Toggle";
import { Section } from "./products/parts";

const SEGMENTS: PromptSegment[] = ["system", "user", "single"];
const SEGMENT_LABEL: Record<PromptSegment, string> = {
  system: "System",
  user: "User",
  single: "Prompt",
};

/** Editor for one block (text + on/off toggle + reset to shipped default). */
function BlockEditor({
  block,
  defaultText,
  onChange,
}: {
  block: PromptBlock;
  defaultText: string;
  onChange: (patch: Partial<PromptBlock>) => void;
}) {
  const overridden = block.text !== defaultText;
  const disabled = block.enabled === false;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-sm font-medium text-ink-700">
        <span>{block.id}</span>
        {block.enabledWhen && (
          <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-500">
            if {block.enabledWhen}
          </span>
        )}
        {overridden && <span className="text-[10px] font-normal text-brand-600">edited</span>}
      </div>
      <Textarea
        rows={Math.min(8, Math.max(2, Math.ceil(block.text.length / 90)))}
        value={block.text}
        onChange={(e) => onChange({ text: e.target.value })}
        className={`font-mono text-xs leading-relaxed ${disabled ? "opacity-50" : ""}`}
      />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-[11px] text-ink-500">
          <Toggle
            checked={block.enabled !== false}
            onChange={(v) => onChange({ enabled: v })}
            label="Block enabled"
          />
          {disabled ? "Disabled" : "Enabled"}
        </label>
        {overridden && (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RotateCcw className="size-3.5" />}
            onClick={() => onChange({ text: defaultText })}
          >
            Reset text
          </Button>
        )}
      </div>
    </div>
  );
}

/** Editor + live preview for a single template (an action variant). */
function TemplateEditor({
  meta,
  template,
  onChangeBlock,
  onResetTemplate,
  config,
}: {
  meta: PromptTemplateMeta;
  template: PromptsConfig["templates"][string];
  onChangeBlock: (seg: PromptSegment, blockId: string, patch: Partial<PromptBlock>) => void;
  onResetTemplate: () => void;
  config: PromptsConfig;
}) {
  const def = defaultTemplate(meta.key);
  const defaultTextFor = (seg: PromptSegment, id: string) =>
    def[seg]?.find((b) => b.id === id)?.text ?? "";

  const preview = useMemo(() => {
    const vars = Object.fromEntries(meta.variables.map((v) => [v.name, v.sample]));
    const ctx = { vars, flags: meta.sampleFlags };
    const hasSingle = (template.single?.length ?? 0) > 0;
    if (hasSingle) return { single: renderSinglePrompt(config, meta.key, ctx) };
    return renderTextPrompt(config, meta.key, ctx);
  }, [config, meta, template]);

  return (
    <Section
      title={meta.label}
      hint={meta.description}
      action={
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<RotateCcw className="size-3.5" />}
          onClick={onResetTemplate}
        >
          Reset variant
        </Button>
      }
    >
      <div className="space-y-4">
        {SEGMENTS.map((seg) => {
          const blocks = template[seg];
          if (!blocks?.length) return null;
          return (
            <div key={seg} className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                {SEGMENT_LABEL[seg]}
              </p>
              {blocks.map((block) => (
                <BlockEditor
                  key={block.id}
                  block={block}
                  defaultText={defaultTextFor(seg, block.id)}
                  onChange={(patch) => onChangeBlock(seg, block.id, patch)}
                />
              ))}
            </div>
          );
        })}

        <details className="rounded-lg ring-1 ring-inset ring-ink-100">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            <ChevronDown className="size-3.5" />
            Live preview (sample values)
          </summary>
          <div className="space-y-2 border-t border-ink-100 p-3">
            {"single" in preview ? (
              <pre className="whitespace-pre-wrap wrap-break-word rounded bg-ink-50 p-2 font-mono text-[11px] leading-relaxed text-ink-600">
                {preview.single}
              </pre>
            ) : (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">System</p>
                <pre className="whitespace-pre-wrap wrap-break-word rounded bg-ink-50 p-2 font-mono text-[11px] leading-relaxed text-ink-600">
                  {preview.system}
                </pre>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">User</p>
                <pre className="whitespace-pre-wrap wrap-break-word rounded bg-ink-50 p-2 font-mono text-[11px] leading-relaxed text-ink-600">
                  {preview.user}
                </pre>
              </>
            )}
            <p className="pt-1 text-[10px] leading-relaxed text-ink-400">
              Variables:{" "}
              {meta.variables.map((v) => `{{${v.name}}}`).join(", ") || "none"}
            </p>
          </div>
        </details>
      </div>
    </Section>
  );
}

export function PromptsTab() {
  const stored = useAppConfigStore((s) => s.prompts);
  const save = useAppConfigStore((s) => s.savePrompts);

  const [draft, setDraft] = useState<PromptsConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState(PROMPT_ACTIONS[0].actionId);

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const activeAction = PROMPT_ACTIONS.find((a) => a.actionId === actionId) ?? PROMPT_ACTIONS[0];

  const changeBlock = (
    key: string,
    seg: PromptSegment,
    blockId: string,
    patch: Partial<PromptBlock>,
  ) => {
    setDraft((d) => {
      const tpl = d.templates[key] ?? {};
      const blocks = (tpl[seg] ?? []).map((b) => (b.id === blockId ? { ...b, ...patch } : b));
      return { ...d, templates: { ...d.templates, [key]: { ...tpl, [seg]: blocks } } };
    });
    setDirty(true);
  };

  const resetTemplate = (key: string) => {
    setDraft((d) => {
      const def = defaultTemplate(key);
      const clone: PromptsConfig["templates"][string] = JSON.parse(JSON.stringify(def));
      return { ...d, templates: { ...d.templates, [key]: clone } };
    });
    setDirty(true);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Prompts saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save prompts.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
          Edit the wording of every LLM prompt the app makes. Blocks are joined in order;
          conditional blocks (tagged <span className="font-mono">if …</span>) are only included when
          the pipeline sets that flag. <span className="font-mono">{"{{variables}}"}</span> are filled
          in at runtime. Empty edits fall back to the shipped defaults.
        </p>
        <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void onSave()}>
          Save changes
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {PROMPT_ACTIONS.map((action) => (
          <button
            key={action.actionId}
            type="button"
            onClick={() => setActionId(action.actionId)}
            className={
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
              (actionId === action.actionId
                ? "bg-brand-600 text-white shadow-sm"
                : "bg-white text-ink-600 ring-1 ring-inset ring-ink-100 hover:bg-ink-50")
            }
          >
            {action.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-ink-500">{activeAction.description}</p>

      <div className="space-y-3">
        {activeAction.templates.map((meta) => (
          <TemplateEditor
            key={meta.key}
            meta={meta}
            template={draft.templates[meta.key] ?? {}}
            config={draft}
            onChangeBlock={(seg, blockId, patch) => changeBlock(meta.key, seg, blockId, patch)}
            onResetTemplate={() => resetTemplate(meta.key)}
          />
        ))}
      </div>
    </div>
  );
}
