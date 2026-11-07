import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { PreviewBanner } from "@/components/preview-banner";
import { GrowthCollector } from "@/components/growth/growth-collector";

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
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${neueFreigeist.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <PreviewBanner />
        <GrowthCollector />
        {children}
      </body>
    </html>
  );
}
