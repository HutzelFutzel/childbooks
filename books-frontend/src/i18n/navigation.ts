/**
 * Locale-aware replacements for `next/link` and the navigation hooks.
 *
 * These wrap the routing config, so `<Link href="/blog">` resolves to `/blog`
 * for English and `/de/blog` for German without any call site repeating the
 * prefix rule. `usePathname` returns the path *without* the locale segment,
 * which is what makes "switch language, stay on this page" expressible.
 *
 * Existing `next/link` imports are left alone on purpose: while English is the
 * only published locale every path is already correct, and rewriting hundreds of
 * links would be a large diff whose behaviour can't be verified until a second
 * locale is routed. New localized links should come from here.
 */
import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
