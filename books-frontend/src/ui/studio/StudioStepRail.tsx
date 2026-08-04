import { motion } from "framer-motion";
import {
  BookText,
  Check,
  ImagePlus,
  LayoutTemplate,
  Loader2,
  Lock,
  Printer,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";
import { useStudio } from "./StudioContext";
import {
  computeProgress,
  DESIGN_SUBSTEPS,
  designSubstepOf,
  preferredDesignStep,
  PRIMARY_STEPS,
  primaryOf,
  stepForDesignSubstep,
  type DesignSubstep,
  type PrimaryStep,
  type StudioStep,
} from "./studioSteps";

const PRIMARY_META: Record<
  PrimaryStep,
  { label: string; hint: string; icon: LucideIcon }
> = {
  story: { label: "Story", hint: "Write it & pick a look", icon: BookText },
  design: { label: "Design", hint: "Cast & pages", icon: LayoutTemplate },
  order: { label: "Order", hint: "Print your book", icon: Printer },
};

const SUBSTEP_META: Record<
  DesignSubstep,
  { label: string; hint: string; icon: LucideIcon }
> = {
  cast: { label: "Cast", hint: "Character & place looks", icon: ImagePlus },
  pages: { label: "Pages", hint: "Layout & illustrations", icon: LayoutTemplate },
};

/**
 * Guided rail: Story → Design → Order. When Design is active, a Cast | Pages
 * sub-rail appears underneath (Pages locked until cast is complete).
 */
export function StudioStepRail() {
  const { project, step, setStep, generatingAnchors, generatingPages } = useStudio();
  const progress = computeProgress(project);
  const primary = primaryOf(step);
  const busyAnchors = generatingAnchors.size > 0;
  const busyPages = generatingPages.size > 0;
  const designBusy = busyAnchors || busyPages;

  function goPrimary(id: PrimaryStep) {
    if (id === "design") {
      // Prefer the unfinished substep; if both done, stay on pages (or cast if that's open).
      if (primary === "design") return;
      setStep(preferredDesignStep(project));
      return;
    }
    setStep(id);
  }

  return (
    <div className="relative border-b border-ink-100 bg-white/80 backdrop-blur-md">
      <div className="px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center gap-1 sm:gap-2">
          {PRIMARY_STEPS.map((id, i) => {
            const meta = PRIMARY_META[id];
            const p = progress[id];
            const active = primary === id;
            const inProgress = id === "design" && designBusy;
            const Icon = meta.icon;

            return (
              <div key={id} className="flex flex-1 items-center">
                <button
                  type="button"
                  disabled={!p.unlocked}
                  onClick={() => p.unlocked && goPrimary(id)}
                  className={cn(
                    "group relative flex flex-1 items-center gap-3 rounded-2xl px-3 py-2 text-left transition",
                    active
                      ? "bg-brand-50 ring-1 ring-brand-200"
                      : p.unlocked
                        ? "hover:bg-ink-50"
                        : "cursor-not-allowed opacity-45",
                  )}
                >
                  <StepBadge
                    index={i + 1}
                    active={active}
                    done={p.done}
                    locked={!p.unlocked}
                    inProgress={inProgress}
                    Icon={Icon}
                  />
                  <span className="hidden min-w-0 flex-col leading-tight sm:flex">
                    <span
                      className={cn(
                        "flex items-center gap-1.5 text-sm font-bold",
                        active ? "text-brand-700" : p.done ? "text-ink-800" : "text-ink-600",
                      )}
                    >
                      {meta.label}
                      {p.detail && (
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                            p.done ? "bg-emerald-100 text-emerald-700" : "bg-ink-100 text-ink-500",
                          )}
                        >
                          {p.detail}
                        </span>
                      )}
                    </span>
                    <span className="truncate text-[11px] text-ink-400">{meta.hint}</span>
                  </span>
                  {active && (
                    <motion.span
                      layoutId="studio-step-underline"
                      className="absolute inset-x-3 bottom-[-13px] hidden h-0.5 rounded-full bg-brand-500 sm:block"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                </button>

                {i < PRIMARY_STEPS.length - 1 && (
                  <Connector filled={progress[PRIMARY_STEPS[i]].done} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {primary === "design" && (
        <DesignSubRail
          step={step}
          castUnlocked={progress.anchors.unlocked}
          pagesUnlocked={progress.edit.unlocked}
          castDone={progress.anchors.done}
          pagesDone={progress.edit.done}
          castDetail={progress.anchors.detail}
          pagesDetail={progress.edit.detail}
          busyCast={busyAnchors}
          busyPages={busyPages}
          onSelect={(sub) => setStep(stepForDesignSubstep(sub))}
        />
      )}
    </div>
  );
}

function DesignSubRail({
  step,
  castUnlocked,
  pagesUnlocked,
  castDone,
  pagesDone,
  castDetail,
  pagesDetail,
  busyCast,
  busyPages,
  onSelect,
}: {
  step: StudioStep;
  castUnlocked: boolean;
  pagesUnlocked: boolean;
  castDone: boolean;
  pagesDone: boolean;
  castDetail?: string;
  pagesDetail?: string;
  busyCast: boolean;
  busyPages: boolean;
  onSelect: (sub: DesignSubstep) => void;
}) {
  const active = designSubstepOf(step);

  return (
    <div className="border-t border-ink-100 bg-ink-50/60 px-4 py-2">
      <div className="mx-auto flex max-w-5xl items-center gap-1">
        <span className="mr-2 hidden text-[11px] font-semibold uppercase tracking-wide text-ink-400 sm:inline">
          Design
        </span>
        <div className="flex flex-1 items-center gap-1 rounded-xl bg-white/80 p-0.5 ring-1 ring-ink-100 sm:flex-none">
          {DESIGN_SUBSTEPS.map((id) => {
            const meta = SUBSTEP_META[id];
            const unlocked = id === "cast" ? castUnlocked : pagesUnlocked;
            const done = id === "cast" ? castDone : pagesDone;
            const detail = id === "cast" ? castDetail : pagesDetail;
            const busy = id === "cast" ? busyCast : busyPages;
            const isActive = active === id;
            const Icon = meta.icon;

            return (
              <button
                key={id}
                type="button"
                disabled={!unlocked}
                title={
                  unlocked
                    ? meta.hint
                    : id === "pages"
                      ? "Finish cast references before designing pages"
                      : meta.hint
                }
                onClick={() => unlocked && onSelect(id)}
                className={cn(
                  "relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition sm:flex-none sm:px-4",
                  isActive
                    ? "bg-brand-50 text-brand-700 shadow-soft ring-1 ring-brand-200"
                    : unlocked
                      ? "text-ink-600 hover:bg-ink-50 hover:text-ink-800"
                      : "cursor-not-allowed text-ink-300",
                )}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : done && !isActive ? (
                  <Check className="size-3.5 text-emerald-500" strokeWidth={3} />
                ) : !unlocked ? (
                  <Lock className="size-3.5" />
                ) : (
                  <Icon className="size-3.5" />
                )}
                <span>{meta.label}</span>
                {detail && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                      done ? "bg-emerald-100 text-emerald-700" : "bg-ink-100 text-ink-500",
                    )}
                  >
                    {detail}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StepBadge({
  index,
  active,
  done,
  locked,
  inProgress,
  Icon,
}: {
  index: number;
  active: boolean;
  done: boolean;
  locked: boolean;
  inProgress: boolean;
  Icon: LucideIcon;
}) {
  return (
    <span
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold shadow-soft transition",
        done
          ? "bg-emerald-500 text-white"
          : active
            ? "bg-brand-600 text-(--color-brand-foreground)"
            : locked
              ? "bg-ink-100 text-ink-400"
              : "bg-white text-ink-500 ring-1 ring-inset ring-ink-200",
      )}
    >
      {inProgress ? (
        <Loader2 className="size-4 animate-spin" />
      ) : done ? (
        <Check className="size-5" />
      ) : locked ? (
        <Lock className="size-4" />
      ) : active ? (
        <Icon className="size-[18px]" />
      ) : (
        <span className="tabular-nums">{index}</span>
      )}
      {active && !done && (
        <motion.span
          layoutId="studio-step-glow"
          className="absolute -inset-1 -z-10 rounded-2xl bg-brand-400/25 blur-md"
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
        />
      )}
    </span>
  );
}

function Connector({ filled }: { filled: boolean }) {
  return (
    <div className="mx-0.5 hidden h-0.5 w-6 shrink-0 overflow-hidden rounded-full bg-ink-100 sm:block lg:w-10">
      <motion.div
        className="h-full rounded-full bg-emerald-400"
        initial={false}
        animate={{ width: filled ? "100%" : "0%" }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
    </div>
  );
}
