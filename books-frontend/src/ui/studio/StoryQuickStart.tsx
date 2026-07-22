"use client";

import { useState } from "react";
import { Loader2, PenLine, Wand2 } from "lucide-react";
import { storyDraftRemote } from "../../platform/aiClient";
import { useProjectsStore } from "../../state/projectsStore";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { useResolvedModels } from "../hooks/useResolvedModels";
import { cn } from "../lib/cn";
import { notify } from "../lib/notify";

/** Curated quick-start themes — enough to spark a direction, not a form. */
const THEMES = [
  "A bedtime adventure",
  "Making a new friend",
  "A day of courage",
  "Exploring the forest",
  "A silly mix-up",
  "Learning to share",
];

const HERO_KEY = "quickStartHeroName";

function storedHeroName(): string {
  try {
    return sessionStorage.getItem(HERO_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * The quick-start card: hero name + theme → a complete AI-written first story,
 * so the Story stage is never a blank page. Shown only while the story text is
 * empty; once a draft (or the user's own words) lands, it disappears and the
 * normal editor takes over.
 */
export function StoryQuickStart() {
  const current = useProjectsStore((s) => s.current());
  const updateConfig = useProjectsStore((s) => s.updateConfig);
  const rename = useProjectsStore((s) => s.renameProject);
  const models = useResolvedModels();

  const [name, setName] = useState(storedHeroName);
  const [theme, setTheme] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);

  if (!current) return null;

  async function write() {
    const project = useProjectsStore.getState().current();
    if (!project || !name.trim()) return;
    setWriting(true);
    try {
      const draft = await storyDraftRemote(project, name, theme ?? undefined);
      await updateConfig({ storyText: draft.story });
      if (draft.title) await rename(project.id, draft.title);
      try {
        sessionStorage.removeItem(HERO_KEY);
      } catch {
        /* ignore */
      }
      notify.success(
        "Your story is drafted",
        "Read it below and change anything you like — it's yours now.",
      );
    } catch (err) {
      notify.error(err);
    } finally {
      setWriting(false);
    }
  }

  return (
    <section className="relative overflow-hidden rounded-3xl border border-magic-300/50 bg-magic p-6 shadow-soft">
      <div className="relative">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-magic-500 text-white shadow-soft">
            <Wand2 className="size-4.5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-ink-900">Start with a little magic</h2>
            <p className="text-sm text-ink-500">
              Tell us who the story is about — we'll write a first draft you can make your own.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your hero's name — e.g. Mila"
            maxLength={40}
            className="sm:max-w-60"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() && !writing) void write();
            }}
          />
          <Button
            disabled={!name.trim() || !models}
            loading={writing}
            leftIcon={!writing ? <Wand2 className="size-4" /> : undefined}
            onClick={() => void write()}
          >
            {writing ? "Writing your story…" : "Write my story"}
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {THEMES.map((t) => {
            const active = theme === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(active ? null : t)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition",
                  active
                    ? "bg-magic-500 text-white shadow-soft"
                    : "bg-white/80 text-ink-600 ring-1 ring-ink-200 hover:ring-magic-300",
                )}
              >
                {t}
              </button>
            );
          })}
        </div>

        <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-400">
          {writing ? (
            <>
              <Loader2 className="size-3.5 animate-spin text-magic-500" />
              This usually takes a few seconds…
            </>
          ) : (
            <>
              <PenLine className="size-3.5" />
              Prefer your own words? Just write or paste your story below.
            </>
          )}
        </p>
      </div>
    </section>
  );
}
