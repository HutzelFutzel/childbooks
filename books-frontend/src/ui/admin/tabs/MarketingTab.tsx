import { Megaphone } from "lucide-react";

export function MarketingTab() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl bg-white px-6 py-20 text-center ring-1 ring-ink-100 shadow-soft">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
        <Megaphone className="size-7" />
      </span>
      <div>
        <h2 className="text-lg font-semibold text-ink-900">Marketing</h2>
        <p className="mt-1 max-w-sm text-sm text-ink-500">
          Campaigns, email outreach and growth tools are coming soon.
        </p>
      </div>
      <span className="rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-500">
        Coming soon
      </span>
    </div>
  );
}
