import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedBook } from "../../../server/publishedBook";
import { getBrandingWatermark } from "../../../server/branding";
import { BookPreviewView } from "./BookPreviewView";

// Published content changes when the owner re-publishes, so render per request.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ shareId: string }> };

function describe(summary: string | undefined): string {
  const base = summary?.trim();
  if (base) return base.length > 200 ? `${base.slice(0, 197)}…` : base;
  return "A custom children's picture book made with Childbook Studio.";
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { shareId } = await params;
  const book = await getPublishedBook(shareId);
  if (!book) return { title: "Book not found", robots: { index: false } };

  const description = describe(book.summary);
  const images = book.coverUrl ? [{ url: book.coverUrl }] : undefined;
  return {
    title: book.title,
    description,
    openGraph: {
      title: book.title,
      description,
      type: "article",
      images,
    },
    twitter: {
      card: book.coverUrl ? "summary_large_image" : "summary",
      title: book.title,
      description,
      images: book.coverUrl ? [book.coverUrl] : undefined,
    },
  };
}

export default async function BookPreviewPage({ params }: Params) {
  const { shareId } = await params;
  const book = await getPublishedBook(shareId);
  if (!book) notFound();
  // Only fetch + show the watermark when this book hasn't opted out of it.
  const watermark = book.watermarkRemoved ? null : await getBrandingWatermark();
  return <BookPreviewView book={book} watermark={watermark} />;
}
