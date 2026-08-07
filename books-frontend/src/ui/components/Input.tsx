import { forwardRef } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";
import { useReadOnly } from "./ReadOnlyContext";

const fieldBase =
  "w-full rounded-xl2 bg-white text-ink-800 placeholder:text-ink-400 ring-1 ring-inset ring-ink-200 " +
  "transition focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60";

/** Same footprint as a real input/textarea, but plain text — no ring, no focus state. */
const readOnlyBase = "w-full rounded-xl2 bg-ink-50 px-3.5 text-sm text-ink-700";

function displayValue(value: unknown, type: string | undefined): string {
  if (value === undefined || value === null || value === "") return "—";
  if (type === "password") return "••••••••";
  return String(value);
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    const readOnly = useReadOnly();
    if (readOnly) {
      return (
        <div className={cn(readOnlyBase, "flex h-11 items-center", className)}>
          {displayValue(rest.value, rest.type)}
        </div>
      );
    }
    return (
      <input ref={ref} className={cn(fieldBase, "h-11 px-3.5 text-sm", className)} {...rest} />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  const readOnly = useReadOnly();
  if (readOnly) {
    return (
      <div className={cn(readOnlyBase, "whitespace-pre-wrap py-2.5 leading-relaxed", className)}>
        {displayValue(rest.value, undefined)}
      </div>
    );
  }
  return (
    <textarea
      ref={ref}
      className={cn(fieldBase, "px-3.5 py-2.5 text-sm leading-relaxed resize-y", className)}
      {...rest}
    />
  );
});

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, children, className }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label className="flex items-center gap-1 text-sm font-medium text-ink-700">
          {label}
          {required && <span className="text-brand-500">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}
