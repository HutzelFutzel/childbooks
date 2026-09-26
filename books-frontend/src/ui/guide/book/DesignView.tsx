"use client";

import type { Project } from "../../../core/types";
import { useGuideT } from "../intl";
import {
  BookFormatChoice,
  BookSetupSummary,
  PageLayoutChoice,
} from "./BookSetupChoices";

/** The rich book-pane editor for the same setup values Chat asks about. */
export function DesignView({
  project,
  locked,
}: {
  project: Project;
  locked: boolean;
}) {
  const t = useGuideT("chrome");
  if (locked) {
    return (
      <div className="h-full overflow-y-auto px-5 py-6 sm:px-8">
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-5 shadow-soft ring-1 ring-ink-100">
          <h2 className="font-display text-lg font-semibold text-ink-900">
            {t("bookDesign")}
          </h2>
          <p className="mt-1 mb-4 text-sm text-ink-500">
            {t("bookDesignLocked")}
          </p>
          <BookSetupSummary project={project} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-6 sm:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <section className="rounded-2xl bg-white p-4 shadow-soft ring-1 ring-ink-100 sm:p-5">
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold text-ink-900">
              {t("taskBookFormat")}
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              {t("chooseBookFormatPrompt")}
            </p>
          </div>
          <BookFormatChoice project={project} showPrompt={false} />
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-soft ring-1 ring-ink-100 sm:p-5">
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold text-ink-900">
              {t("taskPageLayout")}
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              {t("choosePageLayoutPrompt")}
            </p>
          </div>
          <PageLayoutChoice project={project} showPrompt={false} />
        </section>
      </div>
    </div>
  );
}
