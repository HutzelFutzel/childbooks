"use client";

import { useAppConfigStore } from "../../state/appConfigStore";
import { cn } from "../lib/cn";

export interface ContactMascotProps {
  /** Optional explicit URL from server rendering (falls back to store, then SVG placeholder). */
  mascotUrl?: string | null;
  size?: "md" | "lg" | "xl";
  className?: string;
}

/**
 * Renders the admin-configurable Contact Mascot (`branding.contactMascot`),
 * falling back to the built-in storybook illustration of Hugo the Hedgehog
 * (with his coral crayon tucked behind his ear and a wax-sealed letter).
 *
 * Designed specifically for **transparent-background PNGs / SVGs**: no enclosed
 * white box or border frame, so the character stands directly on the warm
 * cream postcard surface (`bg-canvas`) with a soft natural paper drop-shadow.
 */
export function ContactMascot({ mascotUrl, size = "md", className }: ContactMascotProps) {
  const storeUrl = useAppConfigStore((s) => s.branding.contactMascot?.imageUrl ?? null);
  const storeAlt = useAppConfigStore((s) => s.branding.contactMascot?.alt);
  const resolvedUrl = mascotUrl !== undefined ? mascotUrl : storeUrl;

  const dim =
    size === "xl"
      ? "size-24 sm:size-28"
      : size === "lg"
        ? "size-20 sm:size-22"
        : "size-16 sm:size-18";

  return (
    <div
      className={cn(
        "relative inline-flex shrink-0 items-end justify-center select-none",
        dim,
        className,
      )}
    >
      {/* Subtle warm ambient paper glow behind the transparent character */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-1 bottom-1 -z-10 h-3/4 rounded-full bg-brand-200/25 blur-xl"
      />
      {resolvedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolvedUrl}
          alt={storeAlt || "Hugo the hedgehog"}
          className="max-h-full w-auto object-contain object-bottom drop-shadow-[0_4px_10px_rgba(20,22,58,0.10)]"
        />
      ) : (
        <HugoCourierSvg className="size-full drop-shadow-[0_4px_10px_rgba(20,22,58,0.08)]" />
      )}
    </div>
  );
}

/**
 * Storybook colored-pencil style vector placeholder of Hugo the Hedgehog:
 * - Dark navy-indigo quills (`#1d2244` / `#2b315c`)
 * - Warm golden-tan paws and ear rims (`#d89756`)
 * - Soft cream face & round belly (`#fdf0df`)
 * - Coral-orange crayon tucked behind his right ear (`#f96a4d`)
 * - Waving paw + holding a tiny cream letter with a coral wax seal
 */
export function HugoCourierSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {/* Subtle ground shadow */}
      <ellipse cx="48" cy="89" rx="22" ry="3.5" fill="#14163A" fillOpacity="0.08" />

      {/* Outer spiky navy-indigo quill silhouette */}
      <path
        d="M17 56C12 48 12 37 16 29L13 23L21 23C24 16 30 12 37 11L40 6L46 11C52 10 58 11 63 15L69 11L70 19C76 23 80 30 81 38L86 41L81 48C83 56 80 65 74 72L78 76L69 78C63 82 55 84 48 84C33 84 22 73 17 56Z"
        fill="#1D2244"
        stroke="#14163A"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />

      {/* Inner layered quill texture strokes */}
      <path
        d="M23 28C28 20 38 15 49 15C61 15 71 22 75 34C78 44 76 58 70 67"
        stroke="#333A6B"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="4 5"
      />
      <path
        d="M31 16L29 11M43 13L43 8M55 14L58 9M67 20L72 17M75 31L80 29M20 36L15 34"
        stroke="#D89756"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeOpacity="0.65"
      />

      {/* Left & Right round ears */}
      <circle cx="27" cy="31" r="7.5" fill="#F6D5B0" stroke="#14163A" strokeWidth="2.2" />
      <circle cx="27" cy="31" r="4" fill="#D89756" />
      <circle cx="67" cy="31" r="7.5" fill="#F6D5B0" stroke="#14163A" strokeWidth="2.2" />
      <circle cx="67" cy="31" r="4" fill="#D89756" />

      {/* Signature Coral Crayon tucked behind Hugo's ear */}
      <g transform="rotate(34 63 27)">
        <rect
          x="53"
          y="23.5"
          width="20"
          height="6.5"
          rx="1.8"
          fill="#F96A4D"
          stroke="#14163A"
          strokeWidth="1.8"
        />
        {/* Crayon conical tip */}
        <path
          d="M53 23.5L47.5 26.75L53 30V23.5Z"
          fill="#E04F2E"
          stroke="#14163A"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        {/* Crayon paper wrapper stripes */}
        <line x1="58" y1="24" x2="58" y2="29.5" stroke="#14163A" strokeWidth="1.5" />
        <line x1="68" y1="24" x2="68" y2="29.5" stroke="#14163A" strokeWidth="1.5" />
      </g>

      {/* Warm golden-ochre body coat */}
      <path
        d="M25 56C25 41 34 33 47 33C60 33 69 41 69 56C69 72 60 83 47 83C34 83 25 72 25 56Z"
        fill="#E5A563"
        stroke="#14163A"
        strokeWidth="2.2"
      />

      {/* Soft cream face & pear-shaped belly */}
      <path
        d="M28 45C28 34.5 36 28 47 28C58 28 66 34.5 66 45C66 52 62 56 60 62C58 72 53 80 47 80C41 80 36 72 34 62C32 56 28 52 28 45Z"
        fill="#FDF0DF"
      />

      {/* Cute little feet */}
      <ellipse
        cx="38"
        cy="83.5"
        rx="7.5"
        ry="4.2"
        fill="#D89756"
        stroke="#14163A"
        strokeWidth="2.2"
      />
      <ellipse
        cx="56"
        cy="83.5"
        rx="7.5"
        ry="4.2"
        fill="#D89756"
        stroke="#14163A"
        strokeWidth="2.2"
      />

      {/* Left arm resting gently */}
      <path
        d="M27 52C22 56 21 64 24 68C26 70 29 68 30 64"
        fill="#D89756"
        stroke="#14163A"
        strokeWidth="2.2"
        strokeLinecap="round"
      />

      {/* Right arm waving / holding letter */}
      <path
        d="M66 53C72 49 77 44 75 39C73 36 69 39 66 45"
        fill="#D89756"
        stroke="#14163A"
        strokeWidth="2.2"
        strokeLinecap="round"
      />

      {/* Eyebrows */}
      <path
        d="M36 35.5C37.5 34 40 34 41.5 35"
        stroke="#14163A"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M52.5 35C54 34 56.5 34 58 35.5"
        stroke="#14163A"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Friendly dark navy eyes with bright catchlights */}
      <circle cx="39.5" cy="41.5" r="3.4" fill="#14163A" />
      <circle cx="38.4" cy="40.3" r="1.2" fill="#FFFFFF" />
      <circle cx="54.5" cy="41.5" r="3.4" fill="#14163A" />
      <circle cx="53.4" cy="40.3" r="1.2" fill="#FFFFFF" />

      {/* Rosy coral-blush cheeks */}
      <ellipse cx="34" cy="46.5" rx="4.5" ry="2.8" fill="#F96A4D" fillOpacity="0.65" />
      <ellipse cx="60" cy="46.5" rx="4.5" ry="2.8" fill="#F96A4D" fillOpacity="0.65" />

      {/* Button nose & warm smile */}
      <ellipse cx="47" cy="45" rx="3.4" ry="2.4" fill="#14163A" />
      <ellipse cx="46" cy="44.2" rx="1.1" ry="0.6" fill="#FFFFFF" fillOpacity="0.7" />
      <path
        d="M43.2 49.2C45 51.5 49 51.5 50.8 49.2"
        stroke="#14163A"
        strokeWidth="2.1"
        strokeLinecap="round"
      />

      {/* Little cream envelope with a coral wax seal held near Hugo's belly/paw */}
      <g transform="rotate(-8 56 64)">
        <rect
          x="44"
          y="57"
          width="24"
          height="16"
          rx="2.5"
          fill="#FFFDF9"
          stroke="#14163A"
          strokeWidth="2"
        />
        {/* Envelope flap */}
        <path
          d="M45 58L56 66L67 58"
          stroke="#14163A"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Coral wax seal */}
        <circle cx="56" cy="65.5" r="3.2" fill="#E04F2E" stroke="#14163A" strokeWidth="1.4" />
      </g>
    </svg>
  );
}
