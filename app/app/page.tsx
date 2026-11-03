
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from "next/link";
import { LaunchArrow } from "@/components/landing/launch-arrow";
import { OrenLogo } from "@/components/brand/oren-logo";
import { ButtonLink } from "@/components/ui";
import { ProductIntroduction } from "@/components/landing/product-introduction";
import styles from "@/components/landing/landing-hero.module.css";
import { ProductFoundations } from "@/components/landing/product-foundations";
import { LandingHeader } from "@/components/landing/landing-header";
import { StockMix } from "@/components/landing/stock-mix";
import { TradingSteps } from "@/components/landing/trading-steps";
import { LandingFaqCta } from "@/components/landing/landing-faq-cta";
import { LandingFooter } from "@/components/landing/landing-footer";


export default function Home() {
  return (
    <div id="top" className="relative min-h-screen overflow-x-clip bg-[#f9f9f7] text-[#111110]">
      <div aria-hidden className={styles.backdrop} />
      <LandingHeader>
        <nav aria-label="Main navigation" className="relative mx-auto flex h-[76px] max-w-[1280px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link aria-label="Oren home" className="flex items-center gap-2.5" href="/">
            <OrenLogo className="h-7 w-7" size={28} />
            <span className="text-[15px] font-semibold tracking-[0.16em]">OREN</span>
          </Link>
          <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-7 text-sm text-[#676762] lg:flex">
            <a className="transition-colors hover:text-[#111110]" href="#product">Product</a>
            <a className="transition-colors hover:text-[#111110]" href="#stock-mix">Stock mix</a>
            <Link className="transition-colors hover:text-[#111110]" href="/app/markets">Markets</Link>
            <Link className="transition-colors hover:text-[#111110]" href="/token">Token</Link>
            <Link className="transition-colors hover:text-[#111110]" href="/roadmap">Roadmap</Link>
            <Link className="transition-colors hover:text-[#111110]" href="/changelog">Changelog</Link>
          </div>
          <ButtonLink className="h-10 rounded-full px-4 text-sm font-medium" href="/app" variant="primary">
            Launch App <LaunchArrow />
          </ButtonLink>
        </nav>
      </LandingHeader>

      <main><section aria-labelledby="hero-heading" className={styles.hero}>
        <div className={styles.introduction}>
          <div className={styles.copy}>
            <h1 className={styles.headline} id="hero-heading">
              Trade tokenized stocks.{" "}<span>With an AI agent.</span>
            </h1>
            <p className={styles.description}>Research markets, build a portfolio, and review every trade on Solana.</p>
            <div className={styles.actions}>
              <ButtonLink className="h-12 rounded-full px-5 text-[14px] font-medium" href="/app" id="launch-oren-cta" variant="primary">
                Launch Oren <LaunchArrow />
              </ButtonLink>
              <Link className={styles.marketLink} href="/app/markets">Explore markets <span aria-hidden><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></Link>
            </div>
          </div>
          <div className={styles.stage}>
            <div aria-hidden className={styles.aura} />
            <div aria-hidden className={styles.ground} />
            <div className={styles.mascot}><OrenLogo attentionTargetId="launch-oren-cta" className={styles.character} interactive size={260} /></div>
          </div>
        </div>
        <ProductIntroduction />
      </section>
      <ProductFoundations />
      <StockMix />
      <TradingSteps />
      <LandingFaqCta />
      </main>
      <LandingFooter />
    </div>
  );
}
