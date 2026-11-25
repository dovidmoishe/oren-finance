import { serializeJsonLd } from "@/lib/seo";

/** Structured data for search engines. Not executed, so the CSP does not apply. */
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
