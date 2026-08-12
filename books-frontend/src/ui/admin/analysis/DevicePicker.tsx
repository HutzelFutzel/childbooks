"use client";

/**
 * The dashboard-wide entry-device filter.
 *
 * The label says "arrived on" rather than "using", and that wording is the whole
 * point: this selects PEOPLE by the form factor of their first session and then
 * shows everything they did afterwards on any device. An event-scoped filter
 * would keep a phone signup and discard that same person's laptop purchase, so
 * mobile would read as converting at nearly zero — the exact opposite of what the
 * data says. See `DeviceFilter` in `core/analytics/types.ts`.
 */
import { Laptop, Smartphone, Tablet } from "lucide-react";
import type { ReactNode } from "react";
import { DEVICE_FILTERS, type DeviceFilter } from "../../../core/analytics/types";
import { cn } from "../../lib/cn";

const OPTIONS: Record<DeviceFilter, { label: string; icon: ReactNode | null }> = {
  all: { label: "Any device", icon: null },
  mobile: { label: "Phone", icon: <Smartphone className="size-3.5" /> },
  tablet: { label: "Tablet", icon: <Tablet className="size-3.5" /> },
  desktop: { label: "Desktop", icon: <Laptop className="size-3.5" /> },
};

export function DevicePicker({
  value,
  onChange,
  disabled,
}: {
  value: DeviceFilter;
  onChange: (device: DeviceFilter) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-1 rounded-full bg-white p-1 ring-1 ring-inset ring-ink-100"
      title="Filters by the device people ARRIVED on, then follows them wherever they went next."
    >
      {DEVICE_FILTERS.map((id) => {
        const opt = OPTIONS[id];
        return (
          <button
            key={id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
              value === id ? "bg-brand-600 text-white shadow-sm" : "text-ink-600 hover:bg-ink-50",
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
