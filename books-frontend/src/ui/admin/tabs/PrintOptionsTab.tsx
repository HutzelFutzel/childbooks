"use client";

import { useAdminTab } from "../adminTabStore";
import { TabIntro } from "./products/parts";
import { PrintOptionsPanel } from "./products/PicturesSection";

/**
 * Print options: the things every print book shares.
 *
 * A cover finish, a binding or a paper looks the same whichever book it is on,
 * so its picture is set once here instead of once per book. This is the
 * standard split in catalog admin (shared attribute library vs. the product
 * that uses it): shared things get one home, and the book editor stays about
 * the book.
 */
export function PrintOptionsTab() {
  const openCatalog = useAdminTab((s) => s.openCatalog);
  return (
    <div className="space-y-4">
      <TabIntro links={[{ label: "← Print books", onClick: () => openCatalog("print") }]} />
      <p className="max-w-2xl text-sm text-ink-500">
        Pictures for every choice a customer can make on a print book — size, binding, paper, cover
        finish. They&apos;re shared by all books, so each one is set once. Uploads take effect
        immediately; there is nothing to save.
      </p>
      <PrintOptionsPanel />
    </div>
  );
}
