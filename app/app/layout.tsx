import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppProviders } from "./providers";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";

const neueFreigeist = localFont({
  variable: "--font-neue-freigeist",
  src: [
    {
      path: "../public/fonts/NeueFreigeistTest-ExtraLight-BF670f2d938b0a5.otf",
      weight: "200",
      style: "normal",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-ExtraLightItalic-BF670f2d9391180.otf",
      weight: "200",
      style: "italic",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-Light-BF670f2d9397f5e.otf",
      weight: "300",
      style: "normal",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-LightItalic-BF670f2d93a2eb5.otf",
      weight: "300",
      style: "italic",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-Regular-BF670f2d93a6313.otf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-RegularItalic-BF670f2d93b0de4.otf",
      weight: "400",
      style: "italic",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-Medium-BF670f2d93af06e.otf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-MediumItalic-BF670f2d93ab615.otf",
      weight: "500",
      style: "italic",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-SemiBold-BF670f2d93b174a.otf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-SemiBoldItalic-BF670f2d93b9158.otf",
      weight: "600",
      style: "italic",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-Bold-BF670f2d9362a70.otf",
      weight: "700",
      style: "normal",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-BoldItalic-BF670f2d9381920.otf",
      weight: "700",
      style: "italic",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-ExtraBold-BF670f2d93794dc.otf",
      weight: "800",
      style: "normal",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-ExtraBoldItalic-BF670f2d9382bd7.otf",
      weight: "800",
      style: "italic",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-Heavy-BF670f2d938c33b.otf",
      weight: "850",
      style: "normal",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-HeavyItalic-BF670f2d939114d.otf",
      weight: "850",
      style: "italic",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-Black-BF670f2d936d319.otf",
      weight: "900",
      style: "normal",
    },
    {
      path: "../public/fonts/NeueFreigeistTest-BlackItalic-BF670f2d936d327.otf",
      weight: "900",
      style: "italic",
    },
  ],
});

export const metadata: Metadata = {
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
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
