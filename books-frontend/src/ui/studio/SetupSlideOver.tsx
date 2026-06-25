import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Settings2, Sparkles } from "lucide-react";
import type { BookConfig } from "../../core/types";
import { useProjectsStore } from "../../state/projectsStore";
import { Button } from "../components/Button";
import { Drawer } from "../components/Drawer";
import { cn } from "../lib/cn";
import { notify } from "../lib/notify";
import { bookConfigSchema } from "../wizard/schema";
import { AudienceStep } from "../wizard/steps/AudienceStep";
import { GraphicsStep } from "../wizard/steps/GraphicsStep";
import { StoryStep } from "../wizard/steps/StoryStep";
import { StyleStep } from "../wizard/steps/StyleStep";
import { TextStep } from "../wizard/steps/TextStep";

/**
 * Slim, single-panel setup. Replaces the old multi-step wizard: story + style +
 * audience are shown inline, with the finer graphics/text choices tucked into an
 * "Advanced" disclosure (sensible defaults mean most people never open it).
 */
export function SetupSlideOver({
  open,
  firstRun,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** First run gates the studio; closing without finishing returns to the library. */
  firstRun: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const project = useProjectsStore((s) => s.current());
  const updateConfig = useProjectsStore((s) => s.updateConfig);
  const [advanced, setAdvanced] = useState(false);

  const config = project?.config;
  const update = (patch: Partial<BookConfig>) => void updateConfig(patch);

  const ready = config ? bookConfigSchema.safeParse(config).success : false;

  function handleSubmit() {
    if (!config) return;
    const result = bookConfigSchema.safeParse(config);
    if (!result.success) {
      notify.error(result.error.issues[0]?.message ?? "Please complete the setup.");
      return;
    }
    onSubmit();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={firstRun ? "Set up your storybook" : "Edit setup"}
      width="w-[44rem]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ink-400">
            {firstRun ? "You can fine-tune everything later in the studio." : "Changes apply to future generations."}
          </p>
          <div className="flex items-center gap-2">
            {!firstRun && (
              <Button variant="ghost" onClick={onClose}>
                Done
              </Button>
            )}
            <Button
              size="lg"
              leftIcon={<Sparkles className="size-5" />}
              disabled={!ready}
              onClick={handleSubmit}
            >
              {firstRun ? "Open studio" : "Save & regenerate later"}
            </Button>
          </div>
        </div>
      }
    >
      {config && (
        <div className="space-y-8">
          <StoryStep config={config} update={update} />
          <div className="border-t border-ink-100 pt-7">
            <StyleStep config={config} update={update} />
          </div>
          <div className="border-t border-ink-100 pt-7">
            <AudienceStep config={config} update={update} />
          </div>

          <div className="border-t border-ink-100 pt-5">
            <button
              onClick={() => setAdvanced((v) => !v)}
              className="flex w-full items-center justify-between rounded-xl px-1 py-1 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-ink-700">
                <Settings2 className="size-4 text-ink-400" />
                Advanced layout options
              </span>
              <ChevronDown
                className={cn("size-4 text-ink-400 transition-transform", advanced && "rotate-180")}
              />
            </button>
            <AnimatePresence initial={false}>
              {advanced && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="space-y-7 pt-6">
                    <GraphicsStep config={config} update={update} />
                    <div className="border-t border-ink-100 pt-7">
                      <TextStep config={config} update={update} />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </Drawer>
  );
}
