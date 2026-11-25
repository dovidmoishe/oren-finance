import type { MetadataRoute } from "next";
import { getChangelog } from "@/content/changelog";
import { sitemapEntries } from "@/lib/seo";
import { getSeoStockIds } from "@/lib/seo-data";

// Rebuilt in the background every six hours so new catalog stocks are listed
// without a deploy. A failed catalog read still serves the static pages.
export const revalidate = 21600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return sitemapEntries({ changelog: getChangelog(), stockIds: await getSeoStockIds() });
}
