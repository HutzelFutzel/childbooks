"use client";

import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, X } from "lucide-react";
import { ContactForm } from "./ContactForm";
import { ContactMascot } from "./ContactMascot";
import { useSupportUiStore } from "../../state/supportUiStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useConsentStore } from "../../state/consentStore";
import { legalUrlByRole, visibleLegalLinks } from "../../core/config/legal";
import { useDialogFocus } from "../lib/dialogFocus";
import { endpaperLift } from "../lib/motion";

/**
 * In-app contact modal styled as an editorial "Reader's Postcard":
 * - Cream paper surface (`bg-canvas`) with a 3px coral head-band and ink hairline
 * - Hugo the Hedgehog correspondence stamp in the header (configurable in Admin → Branding)
 * - Interactive topic chips and stationery inputs inside `ContactForm`
 * - Colophon footer for legal policies and cookie preferences
 */
export function ContactDialog() {
  const open = useSupportUiStore((s) => s.contactOpen);
  const close = useSupportUiStore((s) => s.closeContact);
  const legal = useAppConfigStore((s) => s.legal);
  const cookieEnabled = useAppConfigStore((s) => s.cookieConfig.enabled);
  const openPreferences = useConsentStore((s) => s.openPreferences);

  const titleId = useId();
  const panelRef = useDialogFocus<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  if (typeof document === "undefined") return null;

  const privacyUrl = legalUrlByRole(legal, "privacy") || undefined;
  const links = visibleLegalLinks(legal, "footer");

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-ink-900/45 backdrop-blur-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            variants={endpaperLift}
            initial="hidden"
            animate="show"
            exit="exit"
            className="relative z-10 flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-ink-900/14 bg-canvas shadow-lifted outline-none"
          >
            {/* 3px coral endpaper head-band */}
            <div aria-hidden className="h-[3px] w-full shrink-0 bg-brand-600" />

            {/* Postcard header with Hugo mascot standing directly on the paper rule */}
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-900/[0.08] px-5 py-3.5 sm:px-6">
              <div className="flex min-w-0 items-center gap-3.5">
                <ContactMascot size="md" className="-my-1" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-600">
                      Studio Correspondence
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-ink-900/[0.05] px-2 py-0.5 text-[10px] font-medium text-ink-600">
                      <Clock className="size-2.5 text-brand-600" />
                      Usually 2–4h reply
                    </span>
                  </div>
                  <h2
                    id={titleId}
                    className="mt-0.5 truncate font-display text-lg font-medium tracking-[-0.01em] text-ink-900 sm:text-xl"
                  >
                    Write to Hugo &amp; the team
                  </h2>
                  <p className="truncate text-xs text-ink-500">
                    Questions about your book, an order, or your account — right from here.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="flex size-8 shrink-0 items-center justify-center self-start rounded-full text-ink-400 transition hover:bg-ink-900/[0.06] hover:text-ink-800 focus-visible:outline-2 focus-visible:outline-ink-900"
              >
                <X className="size-4.5" />
              </button>
            </div>

            {/* Postcard body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
              <ContactForm bare privacyUrl={privacyUrl} onSuccess={close} />
            </div>

            {/* Colophon footer for legal links + cookie settings */}
            {(links.length > 0 || cookieEnabled) && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-ink-900/[0.08] bg-ink-900/[0.02] px-5 py-2.5 text-[11px] text-ink-400 sm:px-6">
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                  {links.map((l) => (
                    <a
                      key={l.id}
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="transition hover:text-ink-700"
                    >
                      {l.label}
                    </a>
                  ))}
                  {cookieEnabled && (
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        openPreferences();
                      }}
                      className="transition hover:text-ink-700"
                    >
                      Cookie settings
                    </button>
                  )}
                </div>
                <span className="hidden text-[10px] text-ink-400 sm:inline">
                  Personal human support
                </span>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
