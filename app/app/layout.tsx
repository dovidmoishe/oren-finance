import type { Metadata } from "next";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTimeZone } from "next-intl/server";
import "./globals.css";
import { PreviewBanner } from "@/components/preview-banner";
import { IntlErrorProvider } from "@/i18n/intl-error";
import { LocaleSync } from "@/i18n/locale-sync";
import { openGraphLocale } from "@/i18n/locales";

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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    metadataBase: new URL("https://oren.finance"),
    title: "Oren",
    description: "Tokenized equities portfolio and investing copilot.",
    openGraph: { locale: openGraphLocale(locale) },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const messages = await getMessages();
  const timeZone = await getTimeZone();
  return (
    <html
      lang={locale}
      dir="ltr"
      className={`${neueFreigeist.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
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
