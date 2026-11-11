import type { Metadata } from "next";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import "./globals.css";
import { PreviewBanner } from "@/components/preview-banner";
import en from "@/i18n/messages/en.json";
import { IntlErrorProvider } from "@/i18n/intl-error";
import { LocaleSync } from "@/i18n/locale-sync";
import { DEFAULT_LOCALE } from "@/i18n/locales";

const neueFreigeist = localFont({
  variable: "--font-neue-freigeist",
  // Only the weights the UI uses: 400 (body), 500/600 (font-medium/semibold) and
  // 700 (<b>/<strong>). Every listed face is preloaded on every page.
  src: [
    {
      path: "../public/fonts/NeueFreigeistTest-Regular-BF670f2d93a6313.otf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-Medium-BF670f2d93af06e.otf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-SemiBold-BF670f2d93b174a.otf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-Bold-BF670f2d9362a70.otf",
      weight: "700",
      style: "normal",
    },
  ],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://oren.finance"),
  title: "Oren",
  description: "Tokenized equities portfolio and investing copilot.",
  openGraph: { locale: "en_US" },
};

// English, with no cookies() or headers(), so marketing pages can stay static.
// /app, /connect and /settings replace this provider with the cookie locale.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${neueFreigeist.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground [font-family:var(--font-neue-freigeist),system-ui,sans-serif] selection:bg-[#111111] selection:text-white">
        <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={en} timeZone="UTC">
          <IntlErrorProvider>
            <LocaleSync />
            <PreviewBanner />
            {children}
          </IntlErrorProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
