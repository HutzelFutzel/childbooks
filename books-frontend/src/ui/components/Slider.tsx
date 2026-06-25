import type { InputHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface SliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  value: number;
  onValueChange: (value: number) => void;
}

export function Slider({ value, onValueChange, className, min = 0, max = 100, ...rest }: SliderProps) {
  const pct = ((value - Number(min)) / (Number(max) - Number(min))) * 100;
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onValueChange(Number(e.target.value))}
      className={cn(
        "h-2 w-full cursor-pointer appearance-none rounded-full outline-none",
        "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4",
        "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white",
        "[&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:ring-2 [&::-webkit-slider-thumb]:ring-brand-600",
        className,
      )}
      style={{
        background: `linear-gradient(to right, var(--color-brand-500) ${pct}%, var(--color-ink-200) ${pct}%)`,
      }}
      {...rest}
    />
  );
}
