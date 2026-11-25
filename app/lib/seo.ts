import type { Metadata, MetadataRoute } from "next";

// Search and social metadata shared by the marketing pages and the public market pages.
// This module has no runtime imports so tests can load it on its own.

export const SITE_URL = "https://oren.finance";
export const SITE_NAME = "Oren";
export const X_HANDLE = "@orenfinance_";
export const SOCIAL_PROFILES = ["https://x.com/orenfinance_", "https://t.me/orendotfinance"];

export const HOME_TITLE = "Oren — Trade tokenized stocks on Solana with an AI agent";
export const DEFAULT_DESCRIPTION =
  "Trade tokenized stocks like Tesla, NVIDIA and Apple with an AI agent. Research markets, build a portfolio, and review every trade on Solana.";

export type SocialImage = { url: string; alt: string; width?: number; height?: number };

/**
 * app/opengraph-image.png. Metadata merges shallowly, so a page that sets `openGraph`
 * drops the inherited file image unless it passes one again. pageMetadata does that.
 */
export const DEFAULT_OG_IMAGE: SocialImage = {
  url: "/opengraph-image.png",
  width: 1672,
  height: 941,
  alt: "Oren — a sunlit river valley with terraced hills and distant mountains.",
};

/** Organization logo and manifest icon, rendered from app/icon.svg. */
export const LOGO = { url: "/icon-512.png", width: 512, height: 512 };

const INDEX = { index: true, follow: true };
/** Personal or signed-in surfaces: keep them out of results, but let crawlers follow links out. */
export const PRIVATE_ROBOTS = { index: false, follow: true };
const PREVIEW_ROBOTS = { index: false, follow: false };

/**
 * Preview images are built with NEXT_PUBLIC_DEPLOYMENT_ENV=preview. Production builds
 * default to "production" in app/Dockerfile, so only an explicit preview build is hidden.
 */
export function isIndexable(deploymentEnv = process.env.NEXT_PUBLIC_DEPLOYMENT_ENV) {
  return deploymentEnv !== "preview";
}

/** Site-wide robots metadata. Undefined keeps the default (index, follow). */
export function siteRobots(deploymentEnv?: string): Metadata["robots"] {
  return isIndexable(deploymentEnv) ? undefined : PREVIEW_ROBOTS;
}

export function absoluteUrl(path: string) {
  return new URL(path, SITE_URL).href;
}

type PageSeo = {
  /** Gets the " — Oren" suffix from the root layout; use { absolute } to opt out. */
  title: string | { absolute: string };
  description: string;
  /** Canonical path. Leave it out when the real URL is unknown. */
  path?: string;
  /** "segment" when the route has its own opengraph-image file. */
  image?: SocialImage | "segment";
  /** Social card copy, when it should differ from the page title or description. */
  socialTitle?: string;
  socialDescription?: string;
  article?: { publishedTime: string };
  robots?: Metadata["robots"];
};

/**
 * Metadata for a page that should appear in search results. Social titles and
 * descriptions fall back to the page title and description when Next renders them.
 */
export function pageMetadata({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE,
  socialTitle,
  socialDescription,
  article,
  robots = INDEX,
}: PageSeo): Metadata {
  const shared = {
    siteName: SITE_NAME,
    locale: "en_US",
    ...(path ? { url: path } : {}),
    ...(socialTitle ? { title: socialTitle } : {}),
    ...(socialDescription ? { description: socialDescription } : {}),
    ...(image === "segment" ? {} : { images: [image] }),
  };
  const openGraph: Metadata["openGraph"] = article
    ? { ...shared, type: "article", publishedTime: article.publishedTime }
    : { ...shared, type: "website" };
  return {
    title,
    description,
    ...(path ? { alternates: { canonical: path } } : {}),
    openGraph,
    twitter: { card: "summary_large_image", site: X_HANDLE },
    robots: isIndexable() ? robots : PREVIEW_ROBOTS,
  };
}

export type SeoStock = { id: string; ticker: string; name: string; category?: string };

/** Title, description and canonical path for a stock page. */
export function stockSeo(stock: SeoStock) {
  const name = stock.name.trim();
  const ticker = stock.ticker.trim();
  const label = name.toUpperCase() === ticker.toUpperCase() ? ticker : `${name} (${ticker})`;
  const kind = stock.category === "etf" || /\bETF\b/i.test(name) ? "ETF" : stock.category === "index" ? "index" : "stock";
  // Some issuers already put "Tokenized" in the name.
  const named = /tokeni[sz]ed/i.test(name);
  return {
    title: named ? `${label} price` : `${label} tokenized ${kind} price`,
    description: `Live ${label} price, chart, liquidity and AI research. Trade ${named ? "it" : `the tokenized ${kind}`} on Solana with Oren.`,
    path: `/app/stocks/${encodeURIComponent(stock.id)}`,
  };
}

const STATIC_ROUTES = ["/", "/agents", "/token", "/roadmap", "/changelog", "/app/markets"];

export function sitemapEntries({
  changelog,
  stockIds,
}: {
  changelog: { slug: string; date: string }[];
  stockIds: string[];
}): MetadataRoute.Sitemap {
  const latestRelease = changelog.reduce<string | undefined>((latest, entry) => (!latest || entry.date > latest ? entry.date : latest), undefined);
  return [
    ...STATIC_ROUTES.map((path) => ({
      url: absoluteUrl(path),
      ...(path === "/changelog" && latestRelease ? { lastModified: latestRelease } : {}),
    })),
    ...changelog.map((entry) => ({ url: absoluteUrl(`/changelog/${entry.slug}`), lastModified: entry.date })),
    ...[...new Set(stockIds)].map((id) => ({ url: absoluteUrl(`/app/stocks/${encodeURIComponent(id)}`) })),
  ];
}

export function robotsRules(deploymentEnv?: string): MetadataRoute.Robots {
  if (!isIndexable(deploymentEnv)) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}

const ORGANIZATION_ID = `${SITE_URL}/#organization`;

const publisher = {
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: SITE_NAME,
  url: absoluteUrl("/"),
  logo: { "@type": "ImageObject", url: absoluteUrl(LOGO.url), width: LOGO.width, height: LOGO.height },
};

/** Organization and WebSite for the home page. */
export function siteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      { ...publisher, sameAs: SOCIAL_PROFILES },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: absoluteUrl("/"),
        name: SITE_NAME,
        description: DEFAULT_DESCRIPTION,
        inLanguage: "en",
        publisher: { "@id": ORGANIZATION_ID },
      },
    ],
  };
}

/** Only for questions and answers that are visible on the same page. */
export function faqJsonLd(items: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function changelogJsonLd(entry: { slug: string; title: string; summary: string; date: string; image?: string }) {
  const url = absoluteUrl(`/changelog/${entry.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    url,
    mainEntityOfPage: url,
    headline: entry.title,
    description: entry.summary,
    datePublished: `${entry.date}T12:00:00Z`,
    image: [absoluteUrl(entry.image ?? DEFAULT_OG_IMAGE.url)],
    inLanguage: "en",
    author: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
    publisher,
  };
}

/** JSON.stringify does not escape "<", so a value containing "</script>" could end the tag. */
export function serializeJsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
