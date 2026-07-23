import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

/**
 * Renders an article's Markdown body into brand-styled elements.
 *
 * Security: the body is parsed to an AST and mapped to our own components —
 * `rehype-sanitize` strips any raw/dangerous HTML, and we never use
 * `dangerouslySetInnerHTML` on the input. Safe to render admin-authored content.
 * Shared by the public article page and the admin live preview.
 */
const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-10 font-display text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-10 font-display text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-8 font-display text-xl font-semibold text-ink-900">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-6 font-display text-lg font-semibold text-ink-800">{children}</h4>
  ),
  p: ({ children }) => <p className="mt-5 text-lg leading-relaxed text-ink-700">{children}</p>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 transition hover:decoration-brand-600"
      {...(href?.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="mt-5 list-disc space-y-2 pl-6 text-lg leading-relaxed text-ink-700 marker:text-brand-400">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-5 list-decimal space-y-2 pl-6 text-lg leading-relaxed text-ink-700 marker:text-ink-400">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-7 border-l-4 border-brand-300 bg-brand-50/60 py-1 pl-5 pr-4 text-lg italic text-ink-700">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-10 border-ink-100" />,
  strong: ({ children }) => <strong className="font-semibold text-ink-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ className, children }) => {
    const isBlock = (className ?? "").includes("language-");
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-[0.85em] text-ink-800">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-6 overflow-x-auto rounded-2xl bg-ink-900 p-5 text-sm leading-relaxed text-ink-50">
      {children}
    </pre>
  ),
  img: ({ src, alt }) =>
    typeof src === "string" ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt ?? ""} loading="lazy" className="my-8 w-full rounded-2xl shadow-soft" />
    ) : null,
  table: ({ children }) => (
    <div className="my-7 overflow-x-auto">
      <table className="w-full border-collapse text-left text-base text-ink-700">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-ink-200 px-3 py-2 font-semibold text-ink-900">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-ink-100 px-3 py-2 align-top">{children}</td>,
};

export function Prose({ markdown }: { markdown: string }) {
  return (
    <div className="[&>*:first-child]:mt-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
