/**
 * Money and dates as a given locale writes them.
 *
 * Every function here takes the locale as its first argument, and none of them
 * will infer one. That is the entire point of the module. `Intl` accepts
 * `undefined` to mean "whichever locale the runtime happens to be set to",
 * which is a reasonable default in a browser and the wrong answer on a server:
 * a page rendered in Cloud Run formats its prices in the *container's* locale,
 * not the reader's, so a German visitor was served `$1,234.50` because the
 * machine that drew the page was configured in American English. The bug is
 * invisible in development, where the developer's laptop and the reader usually
 * agree, and it does not throw — it just quietly prints the wrong thing.
 *
 * Passing the locale explicitly makes that class of mistake unrepresentable:
 * there is no argument you can leave out and still compile.
 *
 * These are presentation helpers only. Money arrives already converted — the
 * currency is the seller's, chosen by market, while the formatting is the
 * reader's, chosen by locale. The two are independent, which is why both are
 * parameters: a British visitor shopping the German store sees `1.234,50 €`
 * priced in euros and written the way their own locale writes numbers.
 */

/**
 * Formatters are cached because constructing one is expensive relative to using
 * it, and the price table builds a formatter per cell otherwise — one format
 * across every product and page-count column.
 */
const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function numberFormatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  // Every option that varies between callers has to be in the key, or a cached
  // formatter gets handed back for a different question than it was built for.
  const key = [
    locale,
    options.style ?? "",
    options.currency ?? "",
    options.minimumFractionDigits ?? "",
    options.maximumFractionDigits ?? "",
  ].join("|");
  const hit = numberFormatters.get(key);
  if (hit) return hit;
  const made = new Intl.NumberFormat(locale, options);
  numberFormatters.set(key, made);
  return made;
}

function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = [
    locale,
    options.dateStyle ?? "",
    options.timeStyle ?? "",
    options.year ?? "",
    options.month ?? "",
    options.day ?? "",
  ].join("|");
  const hit = dateFormatters.get(key);
  if (hit) return hit;
  const made = new Intl.DateTimeFormat(locale, options);
  dateFormatters.set(key, made);
  return made;
}

/**
 * A price, in the reader's locale and the seller's currency.
 *
 * Whole amounts keep their `.00`: a column of prices where one row reads "$35"
 * and the next "$34.99" is harder to compare than it needs to be, and the
 * trailing zeros are what make a printed price look like a price.
 *
 * A missing amount formats as zero rather than throwing, because the callers are
 * tables and receipts where one absent tier must not blank the whole page.
 */
export function formatMoney(
  locale: string,
  amount: number | undefined | null,
  currency: string,
): string {
  const n = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  try {
    return numberFormatter(locale, { style: "currency", currency }).format(n);
  } catch {
    // An unknown currency code is a config problem, not a reason to render NaN.
    return `${n.toFixed(2)} ${currency}`;
  }
}

/**
 * A price with whole amounts written whole — `$12`, not `$12.00`.
 *
 * The opposite rule to {@link formatMoney}, and deliberately so. A subscription
 * tier is a headline: `$12 / month` is what the plan is called, and the decimals
 * are noise on a card whose whole job is to be scanned. A price *table* is the
 * other case — there the trailing zeros are what make a column comparable, which
 * is why the two rules live in two functions instead of one flag nobody sets.
 */
export function formatMoneyCompact(locale: string, amount: number, currency: string): string {
  const n = Number.isFinite(amount) ? amount : 0;
  try {
    return numberFormatter(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}

/**
 * A bare number with a fixed number of decimals — `1.50`, or `1,50` in German.
 *
 * For the few places that show a *difference* rather than a price: the binding
 * and paper pickers put `+1.50` next to an option, without a currency symbol,
 * because the symbol already appears on the total right above it. `toFixed` was
 * doing this, which hard-codes the English decimal point and reads as a
 * thousands separator to half of Europe — `+1.50` looks like a hundred and fifty
 * to a German reader.
 */
export function formatDecimal(locale: string, value: number, digits: number): string {
  const n = Number.isFinite(value) ? value : 0;
  try {
    return numberFormatter(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return n.toFixed(digits);
  }
}

const regionNames = new Map<string, Intl.DisplayNames>();

/**
 * A country's name in the reader's language — `Germany`, or `Deutschland`.
 *
 * `Intl.DisplayNames` rather than a translated list, because the browser and
 * Node already ship the CLDR names for every region in every locale. Adding
 * them to the message catalogue would mean asking a translator to retype data
 * they can't improve on, and getting it wrong for whichever countries nobody
 * remembered.
 *
 * Falls back to the caller's own label when a runtime doesn't know the code,
 * which is what keeps a shipping-destination dropdown from rendering blanks.
 */
export function formatCountry(locale: string, code: string, fallback: string): string {
  try {
    let names = regionNames.get(locale);
    if (!names) {
      names = new Intl.DisplayNames([locale], { type: "region" });
      regionNames.set(locale, names);
    }
    return names.of(code.toUpperCase()) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * A date the way the locale writes it — `Jul 23, 2026`, `23. Juli 2026`.
 *
 * Deliberately not `dateStyle: "medium"`: the explicit field widths keep the
 * abbreviated month, which is what fits the blog's byline and the order rows.
 */
export function formatDate(locale: string, ms: number): string {
  if (!Number.isFinite(ms)) return "";
  try {
    return dateFormatter(locale, { year: "numeric", month: "short", day: "numeric" }).format(
      new Date(ms),
    );
  } catch {
    return "";
  }
}

/** A date with the time of day, for receipts and download expiry. */
export function formatDateTime(locale: string, ms: number): string {
  if (!Number.isFinite(ms)) return "";
  try {
    return dateFormatter(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
  } catch {
    return "";
  }
}
