"use client";

/**
 * "Try it": type a sentence a reader might say, pick one of your books, and see
 * which skills the guide would run with which arguments — using the settings as
 * they are in the editor, saved or not. Nothing is applied to the book.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { GuideConfig } from "../../../../core/config/guide";
import { tryGuideTurnRemote, type GuideTryResult } from "../../../../platform/aiClient";
import { useProjectsStore } from "../../../../state/projectsStore";
import { Button } from "../../../components/Button";
import { Section } from "../products/parts";

const EXAMPLES = [
  "Give her an umbrella in her left hand on page 3",
  "Make the text on page 5 bigger",
  "Make every page background light yellow",
  "Add a speech bubble saying hi on page 2",
  "Delete the last page",
];

export function GuideTryPanel({ draft }: { draft: GuideConfig }) {
  const projects = useProjectsStore((s) => s.projects);
  const loaded = useProjectsStore((s) => s.loaded);
  const loadProjects = useProjectsStore((s) => s.load);
  // The admin area is a different route from the studio, so your books may not be in memory yet.
  useEffect(() => {
    if (!loaded) void loadProjects().catch(() => toast.error("Could not load your books."));
  }, [loaded, loadProjects]);
  const [projectId, setProjectId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GuideTryResult | null>(null);

  const project = projects.find((p) => p.id === projectId);

  const run = async () => {
    if (!project || !message.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await tryGuideTurnRemote(project, message.trim(), draft));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not try that sentence.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Try it"
      hint="Reads a sentence with the settings as edited here, saved or not. The book is only read; nothing is changed, saved or counted."
    >
      <div className="space-y-3">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
          aria-label="Book to read the sentence against"
        >
          <option value="">{!loaded ? "Loading your books…" : projects.length === 0 ? "You have no books yet" : "Pick a book…"}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title || "Untitled book"}
            </option>
          ))}
        </select>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          placeholder="What a reader might type…"
          className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setMessage(example)}
              className="rounded-full bg-ink-50 px-3 py-1 text-xs text-ink-700 hover:bg-ink-100"
            >
              {example}
            </button>
          ))}
        </div>
        <Button size="sm" loading={busy} disabled={!project || !message.trim()} onClick={() => void run()}>
          Read it
        </Button>
      </div>

      {result && <TryResult result={result} />}
    </Section>
  );
}

function TryResult({ result }: { result: GuideTryResult }) {
  const none = result.commands.length === 0;
  return (
    <div className="mt-4 space-y-3 rounded-xl bg-white p-4 ring-1 ring-ink-100">
      {!result.skillsOn && (
        <p className="text-sm font-medium text-amber-800">Skills are switched off in these settings, so none can run.</p>
      )}
      <p className="text-xs text-ink-500">
        Read as “{result.intent}” ({Math.round(result.confidence * 100)}% sure)
        {result.facts.length > 0 ? `; also read as facts: ${result.facts.join(", ")}` : ""}
      </p>
      {none ? (
        <p className="text-sm text-ink-700">No skill would run.</p>
      ) : (
        <ol className="space-y-2">
          {result.commands.map((call, index) => (
            <li key={`${call.id}-${index}`} className="rounded-lg bg-ink-50 p-3">
              <p className="text-sm font-semibold text-ink-900">
                {index + 1}. {call.id}{" "}
                <span className="font-normal text-ink-500">({Math.round(call.confidence * 100)}% sure)</span>
              </p>
              <pre className="mt-1 overflow-x-auto text-xs text-ink-700">{JSON.stringify(call.args, null, 2)}</pre>
              {call.evidence && <p className="mt-1 text-xs text-ink-500">From: “{call.evidence}”</p>}
            </li>
          ))}
        </ol>
      )}
      {result.overflowCommands.length > 0 && (
        <p className="text-xs text-amber-800">
          Past the per-message limit, so not run: {result.overflowCommands.map((c) => c.id).join(", ")}
        </p>
      )}
      {result.refusedCommands.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-red-700">Refused before running</p>
          {result.refusedCommands.map((c, index) => (
            <p key={`${c.id}-${index}`} className="text-xs text-red-700">
              {c.id}: {c.reason}
            </p>
          ))}
        </div>
      )}
      {result.reply && <p className="text-xs text-ink-500">The guide would also say: “{result.reply}”</p>}
    </div>
  );
}
