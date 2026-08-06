"use client";

import {
  BookOpen,
  Calculator,
  Cookie,
  CreditCard,
  Download,
  ExternalLink,
  Handshake,
  LogOut,
  Package,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import { useAuthStore } from "../../state/authStore";
import { useAccountUiStore } from "../../state/accountUiStore";
import { useBillingUiStore } from "../../state/billingUiStore";
import { useOrdersStore } from "../../state/ordersStore";
import { unseenDownloadCount, useDownloadsStore } from "../../state/downloadsStore";
import { useConsentStore } from "../../state/consentStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { visibleLegalLinks } from "../../core/config/legal";
import { Button } from "../components/Button";
import { Popover } from "../components/Popover";
import { MenuDivider, MenuHeader, MenuItem, MenuSectionLabel, UserMenuTrigger } from "../components/UserMenu";

/**
 * The account dropdown — the single home for user actions that used to clutter
 * the top bar: Settings (image quality + account), Plans, Orders, Admin, and
 * Sign out. Signed-out users just get a "Sign in" button.
 *
 * "Contact us" deliberately isn't duplicated in here — the always-visible
 * `HelpButton` right next to this menu already covers it for every auth
 * state, so a second identical entry here would just be the same action
 * twice. See `ui/contact/HelpButton`.
 */
export function AuthMenu() {
  const user = useAuthStore((s) => s.user);
  const ready = useAuthStore((s) => s.ready);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const signOutUser = useAuthStore((s) => s.signOutUser);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);
  const openSettings = useAccountUiStore((s) => s.openSettings);
  const openOrders = useAccountUiStore((s) => s.openOrders);
  const openDownloads = useAccountUiStore((s) => s.openDownloads);
  const openInvite = useAccountUiStore((s) => s.openInvite);
  const accessLevel = useAuthStore((s) => s.accessLevel);
  const referralEnabled = useAppConfigStore((s) => s.referral.enabled);
  const openPlans = useBillingUiStore((s) => s.openPlans);
  const openCookiePreferences = useConsentStore((s) => s.openPreferences);
  const legal = useAppConfigStore((s) => s.legal);
  const cookieEnabled = useAppConfigStore((s) => s.cookieConfig.enabled);
  const legalLinks = visibleLegalLinks(legal, "footer");
  const ordersNeedAttention = useOrdersStore((s) =>
    s.orders.some((o) => o.stage === "onHold" || o.stage === "error"),
  );
  const unseenDownloads = useDownloadsStore((s) => unseenDownloadCount(s.downloads));

  // Anything on the account button worth a nudge: an order needing attention or
  // a freshly-delivered download the user hasn't opened the list to see yet.
  const buttonBadge = ordersNeedAttention || unseenDownloads > 0;

  if (!ready) {
    return <div className="h-8 w-24 animate-pulse rounded-lg bg-ink-100" />;
  }

  const signedIn = Boolean(user) && !user?.isAnonymous;

  if (!signedIn) {
    return (
      <Button variant="secondary" size="sm" onClick={() => openAuthDialog()}>
        Sign in
      </Button>
    );
  }

  return (
    <Popover
      align="end"
      panelClassName="w-64 overflow-hidden p-0"
      trigger={(open) => <UserMenuTrigger user={user} open={open} badge={buttonBadge} />}
    >
      {(close) => (
        <>
          <MenuHeader user={user} />

          <div className="py-1">
            <MenuSectionLabel>Account</MenuSectionLabel>
            <MenuItem icon={<Settings className="size-4" />} label="Settings" onClick={() => { close(); openSettings(); }} />
            <MenuItem icon={<CreditCard className="size-4" />} label="Plans" onClick={() => { close(); openPlans(); }} />
            <MenuItem
              icon={<Package className="size-4" />}
              label="Orders"
              badge={ordersNeedAttention}
              onClick={() => { close(); openOrders(); }}
            />
            <MenuItem
              icon={<Download className="size-4" />}
              label="Downloads"
              badge={unseenDownloads > 0}
              count={unseenDownloads}
              onClick={() => { close(); openDownloads(); }}
            />
            {referralEnabled && accessLevel !== "guest" && (
              <MenuItem
                icon={<Users className="size-4" />}
                label="Invite friends"
                onClick={() => { close(); openInvite(); }}
              />
            )}
          </div>

          <MenuDivider />
          <div className="py-1">
            <MenuSectionLabel>Resources</MenuSectionLabel>
            {/*
              New tab, like the other Resources links: this menu sits inside the
              Studio, and the Studio is a full-screen editor a project is open
              in — navigating someone away from it just to check a price would
              cost them their place. See the print-pricing pages for why the
              calculator itself needs no account: `ui/pricing/PriceSimulator`.
            */}
            <MenuItem
              icon={<Calculator className="size-4" />}
              label="Print pricing calculator"
              href="/print-pricing"
              openInNewTab
              trailingIcon={<ExternalLink className="size-3.5" />}
              onClick={close}
            />
            <MenuItem
              icon={<BookOpen className="size-4" />}
              label="Blog"
              href="/blog"
              openInNewTab
              trailingIcon={<ExternalLink className="size-3.5" />}
              onClick={close}
            />
            <MenuItem
              icon={<Handshake className="size-4" />}
              label="Affiliate program"
              href="/affiliates"
              openInNewTab
              trailingIcon={<ExternalLink className="size-3.5" />}
              onClick={close}
            />
            {legalLinks.map((l) => (
              <MenuItem
                key={l.id}
                icon={<ExternalLink className="size-4" />}
                label={l.label}
                href={l.url}
                openInNewTab
                onClick={close}
              />
            ))}
            {cookieEnabled && (
              <MenuItem
                icon={<Cookie className="size-4" />}
                label="Cookie settings"
                onClick={() => { close(); openCookiePreferences(); }}
              />
            )}
          </div>

          {isAdmin && (
            <>
              <MenuDivider />
              <div className="py-1">
                <MenuItem
                  icon={<Shield className="size-3" />}
                  label="Admin"
                  href="/admin"
                  tone="admin"
                  onClick={close}
                />
              </div>
            </>
          )}

          <MenuDivider />
          <div className="py-1">
            <MenuItem
              icon={<LogOut className="size-4" />}
              label="Sign out"
              tone="danger"
              onClick={() => { close(); void signOutUser(); }}
            />
          </div>
        </>
      )}
    </Popover>
  );
}
