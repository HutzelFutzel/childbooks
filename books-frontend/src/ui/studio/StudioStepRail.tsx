import { motion } from "framer-motion";
import {
  BookText,
  Check,
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
  preferredDesignStep,
  PRIMARY_STEPS,
  primaryOf,
  type PrimaryStep,
} from "./studioSteps";

const PRIMARY_META: Record<
  PrimaryStep,
  { label: string; hint: string; icon: LucideIcon }
> = {
  story: { label: "Story", hint: "Write it & pick who it's for", icon: BookText },
  design: { label: "Design", hint: "Style, cast & pages", icon: LayoutTemplate },
  order: { label: "Order", hint: "Print your book", icon: Printer },
};

/**
 * Guided rail: Story → Design → Order.
 * Design chapters (Style / Cast / Pages) live in the left accordion, not here.
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
