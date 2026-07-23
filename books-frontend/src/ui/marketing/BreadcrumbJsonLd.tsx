/**
 * Emits BreadcrumbList structured data (schema.org) so search engines can show
 * a breadcrumb trail under the result. Server-rendered into the raw HTML.
 * Reusable across child pages (e.g. /contact, future blog/landing pages).
 */
export function BreadcrumbJsonLd({ items }: { items: { name: string; url: string }[] }) {
  if (items.length === 0) return null;

  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return (
    <script
      // eslint-disable-next-line react/no-danger
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
