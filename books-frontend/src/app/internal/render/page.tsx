import type { Metadata } from "next";
import { ServerRenderStage } from "../../../ui/design/ServerRenderStage";

/**
 * The private page the server-side renderer photographs.
 *
 * Not part of the product: no chrome, no navigation, nothing to look at. It
 * exists so headless Chrome can lay a book out with the same components the
 * editor uses and screenshot each page. Reaching it needs a live render job's
 * single-use token; without one it renders nothing at all.
 */
export const metadata: Metadata = {
  title: "Rendering",
  robots: { index: false, follow: false },
};

// Pages are laid out at print resolution (thousands of pixels wide), so this
// route must never be prerendered or cached — every visit is one book, once.
export const dynamic = "force-dynamic";

/**
 * Nothing but the book.
 *
 * A page here is photographed where it sits, so anything else the app floats
 * over the viewport — the cookie banner, the dev-environment badge, Next's own
 * dev overlay — gets printed into the book. (It did: the first server-rendered
 * copy had "We value your privacy" across the bottom of all 23 pages.) The
 * root layout can't be opted out of, so the stage is the only child of `body`
 * left standing, whatever else gets added to the layout later.
 */
const ISOLATE = `
  body { margin: 0; background: #fff; }
  body > *:not([data-render-stage]) { display: none !important; }
`;

export default function InternalRenderPage() {
  return (
    <>
      <style>{ISOLATE}</style>
      <ServerRenderStage />
    </>
  );
}
