import { themeBootScript } from "@/components/theme/theme-script";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import "@fontsource-variable/geist";
import "@fontsource-variable/onest";
import "./globals.css";
import { ChunkLoadRecoveryGate } from "@/components/chunk-load-recovery";
import { PreviewBanner } from "@/components/preview-banner";
import { PerformanceReporter } from "@/components/performance-reporter";
import en from "@/i18n/messages/en.json";
import { IntlErrorProvider } from "@/i18n/intl-error";
import { LocaleSync } from "@/i18n/locale-sync";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import { GrowthCollector } from "@/components/growth/growth-collector";
import { DEFAULT_DESCRIPTION, HOME_TITLE, SITE_NAME, SITE_URL, X_HANDLE, siteRobots } from "@/lib/seo";

// Defaults only. No canonical or og:url here: every page would inherit them.
// No og:title either, so each page's own title fills its social cards.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: HOME_TITLE, template: `%s — ${SITE_NAME}` },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { siteName: SITE_NAME, locale: "en_US", type: "website" },
  twitter: { card: "summary_large_image", site: X_HANDLE },
  robots: siteRobots(),
};

// English, with no cookies() or headers(), so marketing pages can stay static.
// /app, /connect and /settings replace this provider with the cookie locale.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      dir="ltr"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <head><script dangerouslySetInnerHTML={{ __html: themeBootScript }} /></head>
      <body className="min-h-full bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
        <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={en} timeZone="UTC">
          <IntlErrorProvider>
            <LocaleSync />
            <PreviewBanner />
            <GrowthCollector />
            <PerformanceReporter />
            <ChunkLoadRecoveryGate />
            {children}
          </IntlErrorProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
