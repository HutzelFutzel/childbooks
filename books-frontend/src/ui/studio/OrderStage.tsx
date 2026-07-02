import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpenCheck,
  Eye,
  Loader2,
  Printer,
  ShoppingBag,
  TriangleAlert,
} from "lucide-react";
import { pageTrimForConfig } from "../../core/book";
import { bookProductForConfig } from "../../core/book";
import { currentIllustration } from "../../state/ai";
import { illustrationUnits } from "../../state/bookUnits";
import { Button } from "../components/Button";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { PrintBook } from "../design/PrintBook";
import { OrderDialog } from "../checkout/OrderDialog";
import { useStudio } from "./StudioContext";
import { buildDisplaySpreads, type Entry } from "./SpreadEditor";
import { getCursor } from "../../core/versioning";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import { BookPreview } from "./BookPreview";

/**
 * Step 4 · Order. The finish line: flip through the book, print it at home, or
 * order a professionally printed & bound copy. (No PDF/image exports — the goal
 * is a real book in your hands.)
 */
export function OrderStage() {
  const { project, pages, design, setStep } = useStudio();
  const [printing, setPrinting] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const units = illustrationUnits(project);
  const missingArt = useMemo(
    () => units.filter((u) => !currentIllustration(project, u.id)).length,
    [project, units],
  );
  const pageCount = pages.length;
  const sizeLabel = bookProductForConfig(project.config).label;

  const cover = pages.find((p) => p.id === COVER_FRONT_ID) ?? pages[0];

  const displays = useMemo(() => {
    const doc = project.screenplay ? getCursor(project.screenplay).content : null;
    if (!doc) return [];
    const spreadById = new Map(doc.spreads.map((s) => [s.id, s]));
    const entries: Entry[] = [];
    for (const page of pages) {
      if (page.id === COVER_FRONT_ID && doc.frontCover) {
        entries.push({ page, subject: { kind: "cover", coverId: COVER_FRONT_ID, cover: doc.frontCover } });
      } else if (page.id === COVER_BACK_ID && doc.backCover) {
        entries.push({ page, subject: { kind: "cover", coverId: COVER_BACK_ID, cover: doc.backCover } });
      } else {
        const spread = spreadById.get(page.id);
        if (spread) entries.push({ page, subject: { kind: "spread", spread } });
      }
    }
    return buildDisplaySpreads(doc, entries);
  }, [project.screenplay, pages]);

  function handlePrint() {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 300);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <header className="mb-7 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
          <BookOpenCheck className="size-3.5" /> Step 4 · Order
        </span>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-ink-900">Your book is ready</h1>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-500">
          Take one last look, then print it at home or order a beautifully bound copy.
        </p>
      </header>

      <div className="flex flex-col items-center gap-4 rounded-3xl border border-ink-100 bg-white p-6 shadow-soft sm:flex-row sm:items-stretch">
        <CoverThumb blobId={cover?.blobId} aspect={cover?.aspect ?? 1} />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-3 text-center sm:text-left">
          <div>
            <h2 className="truncate text-lg font-bold text-ink-900">{project.title}</h2>
            <p className="text-sm text-ink-500">
              {pageCount} page{pageCount === 1 ? "" : "s"} · {sizeLabel}
            </p>
          </div>
          <Button
            variant="secondary"
            className="self-center sm:self-start"
            leftIcon={<Eye className="size-4" />}
            onClick={() => setPreviewing(true)}
            disabled={displays.length === 0}
          >
            Preview the book
          </Button>
        </div>
      </div>

      {missingArt > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {missingArt} page{missingArt === 1 ? "" : "s"} still {missingArt === 1 ? "has" : "have"} no
            illustration and will print blank.{" "}
            <button onClick={() => setStep("edit")} className="font-semibold underline">
              Finish designing
            </button>{" "}
            first, or continue anyway.
          </span>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <OptionCard
          icon={<ShoppingBag className="size-6" />}
          tone="brand"
          title="Order a printed book"
          desc="Professionally printed, bound and shipped to your door."
          cta="Order print"
          onClick={() => setOrdering(true)}
        />
        <OptionCard
          icon={<Printer className="size-6" />}
          tone="neutral"
          title="Print at home"
          desc="Open your browser's print dialog to print or save as PDF."
          cta={printing ? "Preparing…" : "Print"}
          loading={printing}
          onClick={handlePrint}
        />
      </div>

      <div className="mt-8 flex justify-center">
        <button
          onClick={() => setStep("edit")}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-brand-600"
        >
          <ArrowLeft className="size-3.5" /> Back to design
        </button>
      </div>

      {printing &&
        createPortal(
          <PrintBook pages={pages} design={design} trimIn={pageTrimForConfig(project.config)} />,
          document.body,
        )}

      <OrderDialog
        open={ordering}
        onClose={() => setOrdering(false)}
        project={project}
        pages={pages}
        design={design}
      />

      <AnimatePresence>
        {previewing && displays.length > 0 && (
          <BookPreview displays={displays} onClose={() => setPreviewing(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function CoverThumb({ blobId, aspect }: { blobId?: string; aspect: number }) {
  const url = useBlobUrl(blobId);
  return (
    <div
      className="mx-auto w-40 shrink-0 overflow-hidden rounded-xl bg-ink-100 shadow-lifted ring-1 ring-ink-200"
      style={{ aspectRatio: String(aspect) }}
    >
      {url ? (
        <img src={url} alt="Front cover" className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-xs text-ink-400">
          No cover yet
        </div>
      )}
    </div>
  );
}

function OptionCard({
  icon,
  title,
  desc,
  cta,
  onClick,
  tone,
  loading,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  cta: string;
  onClick: () => void;
  tone: "brand" | "neutral";
  loading?: boolean;
}) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 360, damping: 26 }}
      className="flex flex-col gap-3 rounded-3xl border border-ink-100 bg-white p-5 shadow-soft"
    >
      <span
        className={
          tone === "brand"
            ? "flex size-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-soft"
            : "flex size-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-600"
        }
      >
        {loading ? <Loader2 className="size-6 animate-spin" /> : icon}
      </span>
      <div className="flex-1">
        <h3 className="text-sm font-bold text-ink-900">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">{desc}</p>
      </div>
      <Button
        variant={tone === "brand" ? "primary" : "secondary"}
        loading={loading}
        onClick={onClick}
      >
        {cta}
      </Button>
    </motion.div>
  );
}
