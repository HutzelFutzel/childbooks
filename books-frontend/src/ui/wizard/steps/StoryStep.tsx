import { useEffect, useState } from "react";
import { useProjectsStore } from "../../../state/projectsStore";
import { StoryQuickStart } from "../../studio/StoryQuickStart";
import { Field, Input, Textarea } from "../../components/Input";
import type { StepProps } from "./types";

export function StoryStep({ config, update }: StepProps) {
  const current = useProjectsStore((s) => s.current());
  const rename = useProjectsStore((s) => s.renameProject);
  const [title, setTitle] = useState(current?.title ?? "");

  // Track external renames too (e.g. the quick-start draft titling the book)
  // — while typing, the store title only changes on blur, so this won't fight.
  useEffect(() => {
    setTitle(current?.title ?? "");
  }, [current?.id, current?.title]);

  const wordCount = config.storyText.trim() ? config.storyText.trim().split(/\s+/).length : 0;

  return (
    <div className="space-y-5">
      {/* Never a blank page: while there's no story yet, lead with the AI
          quick-start; it disappears the moment words exist. */}
      {!config.storyText.trim() && <StoryQuickStart />}

      <Field label="Book title">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => current && title.trim() && rename(current.id, title)}
          placeholder="e.g. Luna and the Sleepy Moon"
        />
      </Field>

      <Field
        label="Story text"
        required
        hint={`${wordCount} word${wordCount === 1 ? "" : "s"}`}
      >
        <Textarea
          value={config.storyText}
          onChange={(e) => update({ storyText: e.target.value })}
          placeholder="Once upon a time, in a little house at the edge of the forest…"
          rows={12}
        />
      </Field>
    </div>
  );
}
