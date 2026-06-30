import { cn } from "../lib/cn";

/**
 * Lightweight password-strength heuristic (no external dependency). Scores a
 * password 0–4 from its length and character variety. Firebase enforces a
 * 6-character minimum, so anything shorter is always "Too short".
 */
export function scorePassword(pw: string): number {
  if (pw.length < 6) return 0;
  let score = 1;
  if (pw.length >= 10) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

const META: Record<number, { label: string; color: string }> = {
  0: { label: "Too short", color: "bg-red-400" },
  1: { label: "Weak", color: "bg-red-400" },
  2: { label: "Fair", color: "bg-amber-400" },
  3: { label: "Good", color: "bg-lime-500" },
  4: { label: "Strong", color: "bg-emerald-500" },
};

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const score = scorePassword(password);
  const { label, color } = META[score];

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i < score ? color : "bg-ink-200",
            )}
          />
        ))}
      </div>
      <p
        className={cn(
          "text-xs",
          score <= 1 ? "text-red-600" : score === 2 ? "text-amber-600" : "text-ink-500",
        )}
      >
        Password strength: {label}
      </p>
    </div>
  );
}
