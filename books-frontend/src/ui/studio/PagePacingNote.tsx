"use client";

import { useMemo, useState } from "react";
import { Info, X } from "lucide-react";
import { inspectScreenplayDensity } from "../../core/pipeline/screenplayFit";
import { resolveAudienceProfile } from "../../core/config/audience";
import { useAppConfigStore } from "../../state/appConfigStore";
import type { ScreenplayDoc } from "../../core/types";

/**
 * How the page plan compares with the pacing configured for this age band.
 *
 * Counted, never judged: word counts per page against the band's own maximum,
 * page count against its own range. It appears only when a number is actually
 * out of range, says nothing otherwise, and can be dismissed — an author who
 * wants a wordier page than the band expects is allowed to have one, and the
 * band's targets are as likely to be the thing that needs editing.
 */
export function PagePacingNote({
  screenplay,
  ageRangeId,
}: {
  screenplay: ScreenplayDoc | null;
  ageRangeId: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  const audience = useAppConfigStore((s) => s.audience);
  const ageWriting = useAppConfigStore((s) => s.ageWriting);
  const storyCraft = useAppConfigStore((s) => s.storyCraft);

  const summary = useMemo(() => {
    if (!screenplay) return [];
    const profile = resolveAudienceProfile(ageRangeId, { audience, ageWriting, storyCraft });
    return inspectScreenplayDensity(screenplay, profile).summary;
  }, [screenplay, ageRangeId, audience, ageWriting, storyCraft]);

  if (dismissed || summary.length === 0) return null;

  return (
    <div className="flex items-start gap-2 border-b border-ink-100 bg-ink-50/60 px-3 py-2 sm:px-4">
      <Info className="mt-px size-3.5 shrink-0 text-ink-400" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {summary.map((line) => (
          <p key={line} className="text-xs leading-relaxed text-ink-500">
            {line}
          </p>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-full text-ink-400 transition hover:bg-ink-100 hover:text-ink-600"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
