import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { loadSeo, plain } from "./support/load-seo.mjs";

const production = loadSeo({ NEXT_PUBLIC_DEPLOYMENT_ENV: "production" });
const preview = loadSeo({ NEXT_PUBLIC_DEPLOYMENT_ENV: "preview" });

test("production and local builds are indexable; preview builds are hidden from crawlers", () => {
  assert.equal(loadSeo({}).isIndexable(), true);
  assert.equal(production.isIndexable(), true);
  assert.equal(preview.isIndexable(), false);

  assert.equal(production.siteRobots(), undefined);
  assert.deepEqual(plain(preview.siteRobots()), { index: false, follow: false });

  assert.deepEqual(plain(production.robotsRules()), {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: "https://oren.finance/sitemap.xml",
  });
  assert.deepEqual(plain(preview.robotsRules()), { rules: { userAgent: "*", disallow: "/" } });

  const page = { title: "Roadmap", description: "What comes next.", path: "/roadmap" };
  assert.deepEqual(plain(production.pageMetadata(page).robots), { index: true, follow: true });
  assert.deepEqual(plain(preview.pageMetadata(page).robots), { index: false, follow: false });
});

test("pages that set social metadata keep the site image, canonical url and large card", () => {
  const metadata = production.pageMetadata({ title: "Roadmap", description: "What comes next.", path: "/roadmap" });
  assert.equal(metadata.title, "Roadmap");
  assert.equal(metadata.alternates.canonical, "/roadmap");
  assert.equal(metadata.openGraph.url, "/roadmap");
  assert.equal(metadata.openGraph.siteName, "Oren");
  assert.equal(metadata.openGraph.type, "website");
  assert.deepEqual(plain(metadata.openGraph.images), [plain(production.DEFAULT_OG_IMAGE)]);
  // Next fills og:title and the Twitter card from the page title and the og image.
  assert.equal(Object.hasOwn(metadata.openGraph, "title"), false);
  assert.equal(Object.hasOwn(metadata.twitter, "images"), false);
  assert.deepEqual(plain(metadata.twitter), { card: "summary_large_image", site: "@orenfinance_" });

  const segment = production.pageMetadata({ title: "Agents", description: "d", path: "/agents", image: "segment" });
  assert.equal(Object.hasOwn(segment.openGraph, "images"), false);

  const article = production.pageMetadata({ title: "Release", description: "d", path: "/changelog/release", socialTitle: "Release", article: { publishedTime: "2026-11-20T12:00:00Z" } });
  assert.equal(article.openGraph.type, "article");
  assert.equal(article.openGraph.publishedTime, "2026-11-20T12:00:00Z");
  assert.equal(article.openGraph.title, "Release");

  const unknownUrl = production.pageMetadata({ title: "Tokenized stock", description: "d" });
  assert.equal(Object.hasOwn(unknownUrl, "alternates"), false);
  assert.equal(Object.hasOwn(unknownUrl.openGraph, "url"), false);
});

test("the default social image constants match the committed image", async () => {
  const image = production.DEFAULT_OG_IMAGE;
  const meta = await sharp(readFileSync(new URL("../app/opengraph-image.png", import.meta.url))).metadata();
  assert.equal(meta.width, image.width);
  assert.equal(meta.height, image.height);
  assert.equal(readFileSync(new URL("../app/opengraph-image.alt.txt", import.meta.url), "utf8"), image.alt);

  for (const [file, size] of [["../app/apple-icon.png", 180], ["../public/icon-192.png", 192], ["../public/icon-512.png", 512]]) {
    const icon = await sharp(readFileSync(new URL(file, import.meta.url))).metadata();
    assert.equal(icon.width, size, file);
    assert.equal(icon.height, size, file);
    assert.equal(icon.hasAlpha, false, `${file} must be opaque; iOS fills transparency with black`);
  }
});

test("stock pages name the company, ticker and tokenized asset", () => {
  const tesla = production.stockSeo({ id: "tesla", ticker: "TSLA", name: "Tesla", category: "equity" });
  assert.deepEqual(plain(tesla), {
    title: "Tesla (TSLA) tokenized stock price",
    description: "Live Tesla (TSLA) price, chart, liquidity and AI research. Trade the tokenized stock on Solana with Oren.",
    path: "/app/stocks/tesla",
  });

  assert.equal(production.stockSeo({ id: "roundhill-memory-etf", ticker: "DRAM", name: "Roundhill Memory ETF", category: "etf" }).title, "Roundhill Memory ETF (DRAM) tokenized ETF price");
  assert.equal(production.stockSeo({ id: "x", ticker: "SPX", name: "S&P 500", category: "index" }).title, "S&P 500 (SPX) tokenized index price");
  assert.equal(production.stockSeo({ id: "tsla", ticker: "TSLA", name: "TSLA" }).title, "TSLA tokenized stock price");

  const ondo = production.stockSeo({ id: "stock-isrsjecp", ticker: "SOXLON", name: "Direxion Daily Semi Bull 3X ETF (Ondo Tokenized)", category: "equity" });
  assert.equal(ondo.title, "Direxion Daily Semi Bull 3X ETF (Ondo Tokenized) (SOXLON) price");
  assert.match(ondo.description, /Trade it on Solana with Oren\.$/);

  assert.equal(production.stockSeo({ id: "a b/c", ticker: "AB", name: "AB Corp" }).path, "/app/stocks/a%20b%2Fc");
});

test("the sitemap lists public pages, published releases and each catalog stock once", () => {
  const entries = plain(production.sitemapEntries({
    changelog: [{ slug: "first", date: "2026-11-01" }, { slug: "latest", date: "2026-11-20" }],
    stockIds: ["tesla", "nvidia", "tesla"],
  }));
  const urls = entries.map((entry) => entry.url);
  for (const path of ["/", "/agents", "/token", "/roadmap", "/changelog", "/app/markets"]) {
    assert.ok(urls.includes(`https://oren.finance${path}`), path);
  }
  assert.equal(entries.find((entry) => entry.url === "https://oren.finance/changelog").lastModified, "2026-11-20");
  assert.deepEqual(entries.find((entry) => entry.url.endsWith("/changelog/first")), { url: "https://oren.finance/changelog/first", lastModified: "2026-11-01" });
  assert.deepEqual(urls.filter((url) => url.includes("/app/stocks/")), ["https://oren.finance/app/stocks/tesla", "https://oren.finance/app/stocks/nvidia"]);
  assert.equal(urls.some((url) => /\/app\/(settings|portfolio|vault|calendar)|\/connect\/|\/settings\//.test(url)), false);
  assert.equal(new Set(urls).size, urls.length);
});

test("structured data cannot close its script tag and matches the visible page", () => {
  const hostile = { text: "</script><script>alert(1)</script>" };
  const serialized = production.serializeJsonLd(hostile);
  assert.equal(serialized.includes("<"), false);
  assert.deepEqual(JSON.parse(serialized), hostile);

  const faq = plain(production.faqJsonLd([{ question: "What is Oren?", answer: "A trading terminal." }]));
  assert.equal(faq["@type"], "FAQPage");
  assert.deepEqual(faq.mainEntity, [{ "@type": "Question", name: "What is Oren?", acceptedAnswer: { "@type": "Answer", text: "A trading terminal." } }]);

  const site = plain(production.siteJsonLd());
  const organization = site["@graph"].find((node) => node["@type"] === "Organization");
  assert.deepEqual(organization.sameAs, ["https://x.com/orenfinance_", "https://t.me/orendotfinance"]);
  assert.equal(organization.logo.url, "https://oren.finance/icon-512.png");

  const entry = { slug: "gas", title: "Gas", summary: "Covered.", date: "2026-11-25" };
  const local = plain(production.changelogJsonLd({ ...entry, image: "/changelog/poster.webp" }));
  assert.equal(local["@type"], "BlogPosting");
  assert.equal(local.url, "https://oren.finance/changelog/gas");
  assert.equal(local.datePublished, "2026-11-25T12:00:00Z");
  assert.deepEqual(local.image, ["https://oren.finance/changelog/poster.webp"]);
  assert.deepEqual(plain(production.changelogJsonLd({ ...entry, image: "https://media.example.com/p.jpg" })).image, ["https://media.example.com/p.jpg"]);
  assert.deepEqual(plain(production.changelogJsonLd(entry)).image, ["https://oren.finance/opengraph-image.png"]);
});
