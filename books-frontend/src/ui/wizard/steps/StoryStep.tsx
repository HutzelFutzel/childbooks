import { useEffect, useState } from "react";
import { useProjectsStore } from "../../../state/projectsStore";
import { Field, Input, Textarea } from "../../components/Input";
import type { StepProps } from "./types";

export function StoryStep({ config, update }: StepProps) {
  const current = useProjectsStore((s) => s.current());
  const rename = useProjectsStore((s) => s.renameProject);
  const [title, setTitle] = useState(current?.title ?? "");

  useEffect(() => {
    setTitle(current?.title ?? "");
  }, [current?.id]);

  const wordCount = config.storyText.trim() ? config.storyText.trim().split(/\s+/).length : 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ink-900">Tell your story</h2>
        <p className="mt-1 text-sm text-ink-500">
          Paste or write the children's story. You'll refine wording and pacing in later steps.
        </p>
      </div>

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
