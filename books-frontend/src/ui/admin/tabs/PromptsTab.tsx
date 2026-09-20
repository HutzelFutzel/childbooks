"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Search } from "lucide-react";
import {
  PROMPT_ACTIONS,
  defaultTemplate,
  type PromptTemplateMeta,
} from "../../../core/prompts/registry";
import type { PromptBlock, PromptSegment, PromptTemplate, PromptsConfig } from "../../../core/config/prompts";
import { renderSinglePrompt, renderTextPrompt } from "../../../core/prompts/render";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab } from "../adminTabStore";
import { Button } from "../../components/Button";
import { Input, Textarea } from "../../components/Input";
import { Toggle } from "../../components/Toggle";
import { cn } from "../../lib/cn";
import { AdminSaveBar } from "../AdminPageHeader";
import { EditorTabs, TabIntro } from "./products/parts";

const SEGMENTS: PromptSegment[] = ["system", "user", "single"];
const SEGMENT_LABEL: Record<PromptSegment, string> = {
  system: "System",
  user: "User",
  single: "Prompt",
};

function isTemplateEdited(key: string, template: PromptTemplate | undefined): boolean {
  const def = defaultTemplate(key);
  const current = template ?? {};
  for (const seg of SEGMENTS) {
    const blocks = current[seg] ?? [];
    const defs = def[seg] ?? [];
    if (blocks.length !== defs.length) return true;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i]?.text !== defs[i]?.text) return true;
      if ((blocks[i]?.enabled !== false) !== (defs[i]?.enabled !== false)) return true;
    }
  }
  return false;
}

function isActionEdited(actionId: string, draft: PromptsConfig): boolean {
  const action = PROMPT_ACTIONS.find((a) => a.actionId === actionId);
  if (!action) return false;
  return action.templates.some((meta) => isTemplateEdited(meta.key, draft.templates[meta.key]));
}

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
    <div className="space-y-2 border-t border-ink-100 pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-ink-800">{block.id}</span>
        {block.enabledWhen ? (
          <span className="text-ink-400">if {block.enabledWhen}</span>
        ) : null}
        {overridden ? <span className="text-ink-400">edited</span> : null}
        <label className="ml-auto flex items-center gap-2 text-ink-500">
          <Toggle
            checked={block.enabled !== false}
            onChange={(v) => onChange({ enabled: v })}
            label="Block enabled"
          />
          {disabled ? "Off" : "On"}
        </label>
      </div>
      <Textarea
        rows={Math.min(10, Math.max(3, Math.ceil(block.text.length / 90)))}
        value={block.text}
        onChange={(e) => onChange({ text: e.target.value })}
        className={cn("font-mono text-sm leading-relaxed", disabled && "opacity-50")}
      />
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
  );
}

function TemplatePreview({
  meta,
  template,
  config,
}: {
  meta: PromptTemplateMeta;
  template: PromptTemplate;
  config: PromptsConfig;
}) {
  const preview = useMemo(() => {
    const vars = Object.fromEntries(meta.variables.map((v) => [v.name, v.sample]));
    const ctx = { vars, flags: meta.sampleFlags };
    const hasSingle = (template.single?.length ?? 0) > 0;
    if (hasSingle) return { single: renderSinglePrompt(config, meta.key, ctx) };
    return renderTextPrompt(config, meta.key, ctx);
  }, [config, meta, template]);

  return (
    <div className="space-y-4">
      {"single" in preview ? (
        <pre className="whitespace-pre-wrap wrap-break-word font-mono text-sm leading-relaxed text-ink-700">
          {preview.single}
        </pre>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-xs font-medium text-ink-400">System</p>
            <pre className="whitespace-pre-wrap wrap-break-word font-mono text-sm leading-relaxed text-ink-700">
              {preview.system}
            </pre>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-ink-400">User</p>
            <pre className="whitespace-pre-wrap wrap-break-word font-mono text-sm leading-relaxed text-ink-700">
              {preview.user}
            </pre>
          </div>
        </>
      )}
      <p className="text-sm text-ink-500">
        Variables: {meta.variables.map((v) => `{{${v.name}}}`).join(", ") || "none"}
      </p>
    </div>
  );
}

export function PromptsTab() {
  const stored = useAppConfigStore((s) => s.prompts);
  const save = useAppConfigStore((s) => s.savePrompts);
  const setConfigTab = useAdminTab((s) => s.setConfigTab);

  const [draft, setDraft] = useState<PromptsConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [actionId, setActionId] = useState(PROMPT_ACTIONS[0].actionId);
  const [variantKey, setVariantKey] = useState(PROMPT_ACTIONS[0].templates[0].key);
  const [pane, setPane] = useState<string>("system");

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const actions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PROMPT_ACTIONS;
    return PROMPT_ACTIONS.filter(
      (action) =>
        action.label.toLowerCase().includes(q) ||
        action.actionId.toLowerCase().includes(q) ||
        action.description.toLowerCase().includes(q),
    );
  }, [query]);

  const activeAction = PROMPT_ACTIONS.find((a) => a.actionId === actionId) ?? PROMPT_ACTIONS[0];
  const activeMeta =
    activeAction.templates.find((t) => t.key === variantKey) ?? activeAction.templates[0];
  const template = draft.templates[activeMeta.key] ?? {};
  const availableSegments = SEGMENTS.filter((seg) => (template[seg]?.length ?? 0) > 0);
  const paneItems = [
    ...availableSegments.map((seg) => ({ id: seg, label: SEGMENT_LABEL[seg] })),
    { id: "preview", label: "Preview" },
  ];
  const currentPane = paneItems.some((item) => item.id === pane) ? pane : paneItems[0]?.id ?? "preview";

  const selectAction = (id: string) => {
    const action = PROMPT_ACTIONS.find((a) => a.actionId === id);
    if (!action) return;
    setActionId(id);
    setVariantKey(action.templates[0].key);
    setPane("system");
  };

  const changeBlock = (seg: PromptSegment, blockId: string, patch: Partial<PromptBlock>) => {
    const key = activeMeta.key;
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

  const def = defaultTemplate(activeMeta.key);
  const defaultTextFor = (seg: PromptSegment, id: string) =>
    def[seg]?.find((b) => b.id === id)?.text ?? "";

  return (
    <div className="space-y-4">
      <TabIntro
        links={[
          { label: "Age bands", onClick: () => setConfigTab("audience") },
          { label: "Story craft", onClick: () => setConfigTab("storyCraft") },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-300" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search steps"
              className="pl-8"
            />
          </div>
          {actions.length === 0 ? (
            <p className="px-2.5 py-6 text-sm text-ink-400">No steps match.</p>
          ) : (
            <ul className="space-y-0.5">
              {actions.map((action) => {
                const edited = isActionEdited(action.actionId, draft);
                return (
                  <li key={action.actionId}>
                    <button
                      type="button"
                      onClick={() => selectAction(action.actionId)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition",
                        action.actionId === activeAction.actionId
                          ? "bg-ink-100 text-ink-900"
                          : "text-ink-600 hover:bg-ink-50",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{action.label}</span>
                      {edited ? <span className="shrink-0 text-xs text-ink-400">edited</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-ink-900">{activeAction.label}</h2>
              <p className="mt-0.5 text-sm text-ink-500">{activeMeta.description}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RotateCcw className="size-3.5" />}
              onClick={() => resetTemplate(activeMeta.key)}
            >
              Reset variant
            </Button>
          </div>

          {activeAction.templates.length > 1 && (
            <EditorTabs
              items={activeAction.templates.map((meta) => ({
                id: meta.key,
                label: meta.label,
              }))}
              value={activeMeta.key}
              onChange={(id) => {
                setVariantKey(id);
                setPane("system");
              }}
            />
          )}

          <EditorTabs items={paneItems} value={currentPane} onChange={setPane} />

          {currentPane === "preview" ? (
            <TemplatePreview meta={activeMeta} template={template} config={draft} />
          ) : (
            <div className="space-y-3">
              {(template[currentPane as PromptSegment] ?? []).map((block) => (
                <BlockEditor
                  key={block.id}
                  block={block}
                  defaultText={defaultTextFor(currentPane as PromptSegment, block.id)}
                  onChange={(patch) => changeBlock(currentPane as PromptSegment, block.id, patch)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <AdminSaveBar
        dirty={dirty}
        saving={saving}
        saveLabel="Save prompts"
        onSave={() => void onSave()}
        onDiscard={() => {
          setDraft(stored);
          setDirty(false);
        }}
      />
    </div>
  );
}
