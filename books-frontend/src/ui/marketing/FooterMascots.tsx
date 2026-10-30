import { cn } from "../lib/cn";

export interface FooterMascotsProps {
  url?: string | null;
  alt?: string;
  className?: string;
}

/**
 * Scout the Squirrel on the footer colophon ledge.
 *
 * He peeks up from behind the 1px ink rule with his front paws resting
 * directly *over* the line (`translate-y-[5px]`) and his bushy tail curling
 * up beside him.
 *
 * Uses the admin-uploaded transparent PNG/SVG (`branding.footerMascotRight`)
 * when configured in Admin → Marketing → Branding, and falls back to the
 * ledge-posed SVG illustration when empty.
 */
export function FooterMascots({ url, alt, className }: FooterMascotsProps) {
  return (
    <div
      aria-label="Storybook companion on the colophon ledge"
      className={cn(
        "relative z-10 flex items-end justify-end select-none",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-3 right-0 -z-10 h-16 w-24 rounded-full bg-brand-200/25 blur-2xl"
      />

      <div className="group relative z-10 flex h-19 w-21 shrink-0 translate-y-[5px] items-end justify-center transition-transform duration-300 ease-out hover:translate-y-[3px] sm:h-22 sm:w-24 sm:translate-y-[6px]">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={alt || "Scout the Squirrel peeking over the ledge"}
            className="max-h-full w-auto object-contain object-bottom drop-shadow-[0_3px_8px_rgba(20,22,58,0.08)]"
          />
        ) : (
          <ScoutPeekingLedgeSvg className="size-full" />
        )}
      </div>
    </div>
  );
}

/**
 * Scout the Squirrel peeking up from behind the 1px ledge (`y = 88`), with
 * both front paws resting *over* the ledge (`y = 85..93`) and his big bushy
 * tail curling up on the right.
 */
export function ScoutPeekingLedgeSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {/* Big bushy squirrel tail curling up from the ledge on the right */}
      <path
        d="M56 86C78 86 91 69 89 46C87 27 72 22 61 32C55 38 56 52 54 68"
        fill="#D97828"
        stroke="#14163A"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      {/* Cream tail curl highlight */}
      <path
        d="M62 32C71 24 84 28 87 41C81 36 73 38 68 44"
        fill="#FDF1DC"
      />

      {/* Tufted squirrel ears */}
      <path
        d="M23 30C20 20 23 13 27 13C30 13 33 18 33 26"
        fill="#D97828"
        stroke="#14163A"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      <path
        d="M55 26C55 18 58 13 61 13C65 13 68 20 65 30"
        fill="#D97828"
        stroke="#14163A"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />

      {/* Upper body peeking above the y=88 ledge */}
      <path
        d="M22 64C22 49 30 43 44 43C58 43 64 50 64 64V88H22V64Z"
        fill="#D97828"
        stroke="#14163A"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />

      {/* Cream chest patch */}
      <path
        d="M31 66C31 57 37 53 44 53C51 53 57 57 57 66V88H31V66Z"
        fill="#FDF1DC"
      />

      {/* Russet head + wide cream cheeks */}
      <path
        d="M20 41C20 28 29 22 44 22C59 22 68 28 68 41C68 50 59 55 44 55C29 55 20 50 20 41Z"
        fill="#D97828"
        stroke="#14163A"
        strokeWidth="2.1"
      />
      <path
        d="M22 44C22 39 30 37 44 37C58 37 66 39 66 44C66 50 57 54 44 54C31 54 22 50 22 44Z"
        fill="#FDF1DC"
      />

      {/* Expressive eyes looking slightly left */}
      <ellipse cx="36.5" cy="38.5" rx="4.2" ry="5" fill="#FFFFFF" stroke="#14163A" strokeWidth="1.8" />
      <circle cx="36" cy="39" r="2.8" fill="#14163A" />
      <circle cx="35" cy="37.8" r="1" fill="#FFFFFF" />

      <ellipse cx="51.5" cy="38.5" rx="4.2" ry="5" fill="#FFFFFF" stroke="#14163A" strokeWidth="1.8" />
      <circle cx="51" cy="39" r="2.8" fill="#14163A" />
      <circle cx="50" cy="37.8" r="1" fill="#FFFFFF" />

      {/* Rosy coral cheeks */}
      <ellipse cx="29" cy="44.5" rx="3.6" ry="2.1" fill="#F96A4D" fillOpacity="0.65" />
      <ellipse cx="59" cy="44.5" rx="3.6" ry="2.1" fill="#F96A4D" fillOpacity="0.65" />

      {/* Button nose & smile */}
      <ellipse cx="44" cy="42.5" rx="3" ry="2" fill="#14163A" />
      <path
        d="M40 46.8C42 49 46 49 48 46.8"
        stroke="#14163A"
        strokeWidth="1.9"
        strokeLinecap="round"
      />

      {/* Cozy teal knitted scarf */}
      <path
        d="M25 52C31 55.5 57 55.5 63 52C65 54.5 64 59 60 60C50 62.5 38 62.5 28 60C24 59 23 54.5 25 52Z"
        fill="#187A8C"
        stroke="#14163A"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M43 56L44 71L53 70.5L52 55.5"
        fill="#187A8C"
        stroke="#14163A"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Front paws gripping OVER the 1px ledge (y=85..93) */}
      <ellipse
        cx="29"
        cy="88.5"
        rx="6.8"
        ry="4.2"
        fill="#D97828"
        stroke="#14163A"
        strokeWidth="2"
      />
      <path d="M27 89.5V92M31 89.5V92" stroke="#14163A" strokeWidth="1.5" strokeLinecap="round" />

      <ellipse
        cx="57"
        cy="88.5"
        rx="6.8"
        ry="4.2"
        fill="#D97828"
        stroke="#14163A"
        strokeWidth="2"
      />
      <path d="M55 89.5V92M59 89.5V92" stroke="#14163A" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export { ScoutPeekingLedgeSvg as ScoutSquirrelSvg };
