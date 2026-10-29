import { cn } from "../lib/cn";

export interface FooterMascotsProps {
  leftUrl?: string | null;
  leftAlt?: string;
  centerUrl?: string | null;
  centerAlt?: string;
  rightUrl?: string | null;
  rightAlt?: string;
  className?: string;
}

/**
 * Architectural "Ledge & Book-Stack" character integration for the Footer.
 *
 * Instead of three isolated stickers standing in a flat row, the characters
 * physically interact with the 1px ink colophon rule (`bottom-0` of the parent
 * shelf):
 * - **Momo (Left)**: Seated on a two-book stack resting on the rule, turned
 *   slightly inward reading an open coral hardcover.
 * - **Cleo (Center)**: Perched on the rule with her front paw and striped tail
 *   dangling *below* the 1px line (`translate-y-[11px]`), mirroring how the
 *   navbar's coral bookmark ribbon breaks the top baseline.
 * - **Scout (Right)**: Peeking up from behind the rule with his front paws
 *   resting directly *over* the line (`translate-y-[5px]`) and his bushy tail
 *   curling up beside him.
 *
 * Each slot uses the admin-uploaded transparent PNG/SVG (`branding.footerMascot*`)
 * when configured in Admin → Marketing → Branding, and falls back to the
 * ledge-posed SVG illustration when empty.
 */
export function FooterMascots({
  leftUrl,
  leftAlt,
  centerUrl,
  centerAlt,
  rightUrl,
  rightAlt,
  className,
}: FooterMascotsProps) {
  return (
    <div
      aria-label="Storybook companions on the colophon ledge"
      className={cn(
        "relative z-10 flex items-end justify-end select-none",
        className,
      )}
    >
      {/* Subtle warm paper halo behind the trio so they belong to the page surface */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-3 right-2 -z-10 h-20 w-56 rounded-full bg-brand-200/25 blur-2xl sm:w-68"
      />

      {/* 1. Momo the Mole — seated on a stack of books on the ledge, reading */}
      <div className="group relative -mr-2 flex h-20 w-21 shrink-0 items-end justify-center transition-transform duration-300 ease-out hover:-translate-y-0.5 sm:-mr-1.5 sm:h-23 sm:w-24">
        {leftUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={leftUrl}
            alt={leftAlt || "Momo the Mole reading on a stack of books"}
            className="max-h-full w-auto object-contain object-bottom drop-shadow-[0_3px_8px_rgba(20,22,58,0.08)]"
          />
        ) : (
          <MomoReadingOnLedgeSvg className="size-full" />
        )}
      </div>

      {/* 2. Cleo the Siamese Cat — perched on the rule, tail & paw dangling BELOW the 1px line */}
      <div className="group relative z-20 -mr-1.5 flex h-21 w-20 shrink-0 translate-y-[11px] items-end justify-center transition-transform duration-300 ease-out hover:translate-y-[9px] sm:h-24 sm:w-22 sm:translate-y-[13px]">
        {centerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={centerUrl}
            alt={centerAlt || "Cleo the Cat perched on the ledge"}
            className="max-h-full w-auto object-contain object-bottom drop-shadow-[0_4px_8px_rgba(20,22,58,0.09)]"
          />
        ) : (
          <CleoDanglingOnLedgeSvg className="size-full" />
        )}
      </div>

      {/* 3. Scout the Squirrel — peeking over the ledge, paws resting across the 1px line */}
      <div className="group relative z-10 flex h-19 w-21 shrink-0 translate-y-[5px] items-end justify-center transition-transform duration-300 ease-out hover:translate-y-[3px] sm:h-22 sm:w-24 sm:translate-y-[6px]">
        {rightUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={rightUrl}
            alt={rightAlt || "Scout the Squirrel peeking over the ledge"}
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
 * Momo the Mole seated on a small stack of hardcovers right on the 1px ledge
 * (`y = 95`), leaning slightly right and holding an open coral picture book.
 */
export function MomoReadingOnLedgeSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {/* Book stack resting flush on the y=95 colophon ledge */}
      {/* Bottom book (teal spine, cream pages) */}
      <rect
        x="10"
        y="86"
        width="74"
        height="8.5"
        rx="2"
        fill="#187A8C"
        stroke="#14163A"
        strokeWidth="2"
      />
      <rect x="15" y="88" width="64" height="4.5" rx="1" fill="#FDFBF7" />

      {/* Top book under Momo (golden-amber spine) */}
      <rect
        x="16"
        y="78"
        width="62"
        height="8"
        rx="2"
        fill="#F7B519"
        stroke="#14163A"
        strokeWidth="2"
      />
      <rect x="21" y="80" width="52" height="4" rx="1" fill="#FDFBF7" />

      {/* Momo's plum-brown body seated on the book stack, angled slightly toward Cleo */}
      <path
        d="M25 52C25 30 34 17 49 17C64 17 73 30 73 52C73 69 65 79 49 79C33 79 25 69 25 52Z"
        fill="#6A4862"
        stroke="#14163A"
        strokeWidth="2.1"
      />

      {/* Cream belly & muzzle */}
      <ellipse cx="50" cy="58" rx="15.5" ry="16" fill="#FDF1DF" />
      <path
        d="M36 36C36 29.5 42 26 50 26C58 26 64 29.5 64 36C64 42 58 46 50 46C42 46 36 42 36 36Z"
        fill="#FDF1DF"
      />

      {/* Eyes looking fondly down/right at the open storybook */}
      <ellipse cx="44.5" cy="31.5" rx="2.3" ry="3" fill="#14163A" />
      <circle cx="44" cy="30.5" r="0.9" fill="#FFFFFF" />
      <ellipse cx="57.5" cy="31.5" rx="2.3" ry="3" fill="#14163A" />
      <circle cx="57" cy="30.5" r="0.9" fill="#FFFFFF" />

      {/* Signature round coral spectacles */}
      <circle cx="43.5" cy="31" r="7.2" stroke="#E04F2E" strokeWidth="2.3" />
      <circle cx="57.5" cy="31" r="7.2" stroke="#E04F2E" strokeWidth="2.3" />
      <path d="M50.7 31H50.3" stroke="#E04F2E" strokeWidth="2.3" strokeLinecap="round" />
      <path
        d="M29 30L36.3 31M64.7 31L71 30"
        stroke="#E04F2E"
        strokeWidth="2.1"
        strokeLinecap="round"
      />

      {/* Pink mole nose & gentle reading smile */}
      <ellipse cx="50.5" cy="36" rx="3.2" ry="2.2" fill="#F27D85" />
      <path
        d="M46 40C48 42.2 53 42.2 55 40"
        stroke="#14163A"
        strokeWidth="1.9"
        strokeLinecap="round"
      />

      {/* Golden-yellow knitted scarf */}
      <path
        d="M28 43.5C34 47.5 64 47.5 70 43.5C72 46.5 71 50.5 67 51.5C57 54.5 41 54.5 31 51.5C27 50.5 26 46.5 28 43.5Z"
        fill="#F7B519"
        stroke="#14163A"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M57 48L59 62L67 61L64 47"
        fill="#F7B519"
        stroke="#14163A"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Open coral hardcover picture book held in Momo's lap */}
      <path
        d="M29 59L49 63V77L29 73V59Z"
        fill="#E04F2E"
        stroke="#14163A"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M69 59L49 63V77L69 73V59Z"
        fill="#E04F2E"
        stroke="#14163A"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Cream pages fan */}
      <path
        d="M31 57L49 61.5L67 57V59.5L49 63.5L31 59.5V57Z"
        fill="#FFFDF9"
        stroke="#14163A"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />

      {/* Pink mole paws holding both sides of the open book */}
      <ellipse
        cx="29"
        cy="66"
        rx="5"
        ry="4"
        fill="#F4B8B0"
        stroke="#14163A"
        strokeWidth="1.9"
      />
      <ellipse
        cx="69"
        cy="66"
        rx="5"
        ry="4"
        fill="#F4B8B0"
        stroke="#14163A"
        strokeWidth="1.9"
      />

      {/* Little pink feet peeking out on top of the book stack */}
      <ellipse
        cx="35"
        cy="78"
        rx="7.5"
        ry="3.6"
        fill="#F4B8B0"
        stroke="#14163A"
        strokeWidth="2"
      />
      <ellipse
        cx="63"
        cy="78"
        rx="7.5"
        ry="3.6"
        fill="#F4B8B0"
        stroke="#14163A"
        strokeWidth="2"
      />
    </svg>
  );
}

/**
 * Cleo the Siamese Cat sitting on the ledge (`y = 79`), while her striped
 * cocoa tail and one playful paw hang *below* the ledge (`y = 79..95`) to
 * break the horizontal rule cleanly.
 */
export function CleoDanglingOnLedgeSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 92 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {/* Seated cream cat body resting on the ledge at y=79 */}
      <path
        d="M24 50C22 61 23 76 31 79H59C67 76 68 61 66 50C64 41 26 41 24 50Z"
        fill="#FDF3E3"
        stroke="#14163A"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />

      {/* Left front leg planted on the ledge (y=79) */}
      <path
        d="M33 62L34 79H42.5L43 62"
        fill="#6D4C3B"
        stroke="#14163A"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Right front paw reaching DOWN over the 1px ledge (y=79 -> y=88) */}
      <path
        d="M48 62L48.5 85C48.5 87.5 51 89 53.5 89C56 89 58 87.5 58 85L58.5 62"
        fill="#6D4C3B"
        stroke="#14163A"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Pointed Siamese cocoa ears */}
      <path
        d="M23 26L21 8L36 17Z"
        fill="#6D4C3B"
        stroke="#14163A"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      <path
        d="M67 26L69 8L54 17Z"
        fill="#6D4C3B"
        stroke="#14163A"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />

      {/* Fluffy cream head tilted slightly */}
      <path
        d="M20 32C20 19 30 13 45 13C60 13 70 19 70 32C70 42 61 48 45 48C29 48 20 42 20 32Z"
        fill="#FDF3E3"
        stroke="#14163A"
        strokeWidth="2.1"
      />

      {/* Cocoa-brown face mask */}
      <ellipse cx="45" cy="32.5" rx="16" ry="10" fill="#785543" />

      {/* Big expressive eyes glancing slightly down toward the links */}
      <circle cx="37" cy="31" r="5.2" fill="#FDF3E3" stroke="#14163A" strokeWidth="1.8" />
      <circle cx="37" cy="31.8" r="3.5" fill="#14163A" />
      <circle cx="36" cy="30.5" r="1.1" fill="#FFFFFF" />

      <circle cx="53" cy="31" r="5.2" fill="#FDF3E3" stroke="#14163A" strokeWidth="1.8" />
      <circle cx="53" cy="31.8" r="3.5" fill="#14163A" />
      <circle cx="52" cy="30.5" r="1.1" fill="#FFFFFF" />

      {/* Rosy coral cheeks */}
      <ellipse cx="30" cy="36.5" rx="3.6" ry="2.1" fill="#F96A4D" fillOpacity="0.65" />
      <ellipse cx="60" cy="36.5" rx="3.6" ry="2.1" fill="#F96A4D" fillOpacity="0.65" />

      {/* Coral nose & sweet smile */}
      <path d="M43 34.5H47L45 37Z" fill="#F96A4D" />
      <path
        d="M41.5 38.5C43 40 45 39 45 37.5C45 39 47 40 48.5 38.5"
        stroke="#14163A"
        strokeWidth="1.8"
        strokeLinecap="round"
      />

      {/* Whiskers */}
      <path
        d="M14 31L23 32.5M15 35.5L23 35M76 31L67 32.5M75 35.5L67 35"
        stroke="#14163A"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Golden collar + yellow bow + dark navy star charm */}
      <path
        d="M29 46C35 49 55 49 61 46"
        stroke="#F7B519"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <path
        d="M45 48.5L46.4 51.4L49.6 51.9L47.3 54L47.8 57.1L45 55.6L42.2 57.1L42.7 54L40.4 51.9L43.6 51.4L45 48.5Z"
        fill="#14163A"
      />
      <circle cx="55" cy="46.5" r="2.8" fill="#F7B519" stroke="#14163A" strokeWidth="1.5" />

      {/* Striped Siamese tail curving DOWN below the y=79 ledge to y=94 */}
      <path
        d="M62 72C72 73 77 81 73 89C70 94 63 95 60 91C58 88 62 85 65 86"
        fill="#6D4C3B"
        stroke="#14163A"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      {/* Tail stripe */}
      <path d="M68 79L73 81M67 84L72 87" stroke="#14163A" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
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

      {/* Expressive eyes looking slightly left toward Cleo & Momo */}
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

export {
  MomoReadingOnLedgeSvg as MomoMoleSvg,
  CleoDanglingOnLedgeSvg as CleoCatSvg,
  ScoutPeekingLedgeSvg as ScoutSquirrelSvg,
};

