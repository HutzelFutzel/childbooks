import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { Button } from "../components/Button";
import { cn } from "../lib/cn";
import { useStudio } from "./StudioContext";
import { computeProgress } from "./studioSteps";

type StudioDestination = "story" | "style" | "cast" | "pages" | "order";

const DESTINATIONS: { id: StudioDestination; label: string }[] = [
  { id: "story", label: "Story" },
  { id: "style", label: "Art style" },
  { id: "cast", label: "Characters & places" },
  { id: "pages", label: "Pages" },
];

/**
 * The studio's only persistent workflow navigation.
 *
 * Page thumbnails remain inside Pages because they navigate the book itself,
 * not the creation workflow. On phones this condenses to a labelled select so
 * the canvas keeps almost the full viewport.
 */
export function StudioNavigator() {
  const {
    project,
    step,
    setStep,
    styleSetupOpen,
    openStyleSetup,
    closeStyleSetup,
  } = useStudio();
  const progress = computeProgress(project);
  const styleReady = project.config.styleReady !== false;

  const active: StudioDestination =
    step === "story"
      ? "story"
      : step === "order"
        ? "order"
        : styleSetupOpen || project.config.styleReady === false
          ? "style"
          : step === "anchors"
            ? "cast"
            : "pages";

  const isDone = (id: StudioDestination) => {
    if (id === "story") return progress.story.done;
    if (id === "style") return styleReady;
    if (id === "cast") return progress.anchors.done;
    if (id === "pages") return progress.edit.done;
    return false;
  };

  const detail = (id: StudioDestination) => {
    if (id === "cast") return progress.anchors.detail;
    if (id === "pages") return progress.edit.detail;
    return undefined;
  };

  function navigate(id: StudioDestination) {
    if (id === "story") {
      closeStyleSetup();
      setStep("story");
      return;
    }
    if (id === "style") {
      if (step === "story" || step === "order") setStep("anchors");
      openStyleSetup();
      return;
    }
    closeStyleSetup();
    if (id === "cast") {
      setStep("anchors");
      return;
    }
    if (id === "pages") {
      setStep("edit");
      return;
    }
    setStep("order");
  }

  return (
    <nav
      aria-label="Book creation"
      className="flex min-h-12 shrink-0 items-center gap-2 border-b border-ink-100 bg-white px-2 sm:px-4"
    >
      <div className="relative min-w-0 flex-1 sm:hidden">
        <select
          aria-label="Current book section"
          value={active}
          onChange={(event) => navigate(event.target.value as StudioDestination)}
          className="h-9 w-full appearance-none rounded-lg border border-ink-200 bg-white py-0 pl-3 pr-9 text-sm font-semibold text-ink-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        >
          {[...DESTINATIONS, { id: "order" as const, label: "Preview & order" }].map(
            ({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ),
          )}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
        />
      </div>

      <div className="hidden min-w-0 flex-1 items-center gap-1 sm:flex">
        {DESTINATIONS.map(({ id, label }) => {
          const current = active === id;
          const done = isDone(id);
          const progressDetail = detail(id);

          return (
            <button
              key={id}
              type="button"
              aria-current={current ? "step" : undefined}
              onClick={() => navigate(id)}
              className={cn(
                "flex h-9 min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                current
                  ? "bg-brand-50 text-brand-800"
                  : "text-ink-500 hover:bg-ink-50 hover:text-ink-800",
              )}
            >
              {done && !current && <Check className="size-3.5 shrink-0 text-emerald-600" />}
              <span className="truncate">{label}</span>
              {progressDetail && (
                <span className="hidden text-[11px] tabular-nums text-ink-400 lg:inline">
                  {progressDetail}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {active !== "order" && (
        <Button
          size="sm"
          variant={progress.edit.done ? "primary" : "secondary"}
          rightIcon={<ArrowRight className="size-4" />}
          onClick={() => navigate("order")}
          className="shrink-0"
        >
          <span className="hidden sm:inline">Review & order</span>
          <span className="sm:hidden">{progress.edit.done ? "Order" : "Review"}</span>
        </Button>
      )}
    </nav>
  );
}
