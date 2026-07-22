import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle" | "magic";
type Size = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "ref"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-gradient-to-b from-brand-500 to-brand-600 text-(--color-brand-foreground) shadow-soft hover:from-brand-600 hover:to-brand-700 focus-visible:ring-brand-400",
  secondary:
    "bg-white text-ink-700 ring-1 ring-inset ring-ink-200 hover:bg-ink-50 focus-visible:ring-brand-400",
  ghost:
    "bg-transparent text-ink-600 hover:bg-ink-100 focus-visible:ring-brand-400",
  danger:
    "bg-red-600 text-white shadow-soft hover:bg-red-700 focus-visible:ring-red-400",
  subtle:
    "bg-brand-50 text-brand-700 hover:bg-brand-100 focus-visible:ring-brand-400",
  /** Reserved for AI-generation CTAs — the fixed violet "magic is happening" hue. */
  magic:
    "bg-gradient-to-b from-magic-500 to-magic-700 text-white shadow-soft hover:brightness-110 focus-visible:ring-magic-300",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3 text-sm gap-1.5 rounded-xl",
  md: "h-11 px-4 text-sm gap-2 rounded-2xl",
  lg: "h-13 px-7 text-base gap-2 rounded-2xl",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    leftIcon,
    rightIcon,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -1 }}
      transition={spring}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-colors select-none",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      {...(rest as React.ComponentProps<typeof motion.button>)}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        leftIcon && <span className="shrink-0">{leftIcon}</span>
      )}
      {children}
      {!loading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </motion.button>
  );
});
