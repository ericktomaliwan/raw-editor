/**
 * Renders schema.org structured data as a JSON-LD script tag, the way the
 * Next.js docs recommend. It is a data block, not executable code.
 *
 * `<` is escaped so that nothing inside the JSON can close the script tag
 * early. The data passed in today is all static, but this keeps the component
 * safe if a caller ever includes text that didn't come from the codebase.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
