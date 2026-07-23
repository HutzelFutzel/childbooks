"use client";

import { Modal } from "../components/Modal";
import { ContactForm } from "./ContactForm";
import { useSupportUiStore } from "../../state/supportUiStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useConsentStore } from "../../state/consentStore";
import { legalUrlByRole, visibleLegalLinks } from "../../core/config/legal";

/**
 * In-app contact modal — the "Help" affordance available on every app surface
 * (studio + admin), so contacting support never requires leaving your work. The
 * footer row doubles as the in-app home for legal links + a "Cookie settings"
 * trigger, so even signed-out guests (who don't see the account menu) can reach
 * the policies and withdraw cookie consent.
 */
export function ContactDialog() {
  const open = useSupportUiStore((s) => s.contactOpen);
  const close = useSupportUiStore((s) => s.closeContact);
  const legal = useAppConfigStore((s) => s.legal);
  const cookieEnabled = useAppConfigStore((s) => s.cookieConfig.enabled);
  const openPreferences = useConsentStore((s) => s.openPreferences);

  const privacyUrl = legalUrlByRole(legal, "privacy") || undefined;
  const links = visibleLegalLinks(legal, "footer");

  return (
    <Modal open={open} onClose={close} title="Contact us" size="max-w-lg">
      <ContactForm bare privacyUrl={privacyUrl} />

      {(links.length > 0 || cookieEnabled) && (
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-ink-100 pt-3 text-[11px] text-ink-400">
          {links.map((l) => (
            <a
              key={l.id}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-ink-600"
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
              className="transition hover:text-ink-600"
            >
              Cookie settings
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
