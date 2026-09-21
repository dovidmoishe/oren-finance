import Link from "next/link";
import { OrenLogo } from "@/components/brand/oren-logo";
import { ButtonLink } from "@/components/ui";

function Arrow() {
  return (
    <svg aria-hidden className="transition-transform group-hover:translate-x-0.5" fill="none" height="16" viewBox="0 0 16 16" width="16">
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f9f9f7] text-[#111110]">
      <div aria-hidden className="landing-hero-landscape pointer-events-none absolute inset-x-0 top-0 h-[min(960px,100svh)]" />
      <nav aria-label="Main navigation" className="relative z-20 mx-auto flex h-[76px] max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
        <Link aria-label="Oren home" className="flex items-center gap-2.5" href="/">
          <OrenLogo className="h-7 w-7" size={28} />
          <span className="text-[15px] font-semibold tracking-[0.16em]">OREN</span>
        </Link>
        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 text-sm text-[#676762] md:flex">
          <a className="transition-colors hover:text-[#111110]" href="#product">Product</a>
          <Link className="transition-colors hover:text-[#111110]" href="/app/markets">Markets</Link>
        </div>
        <ButtonLink className="h-10 rounded-full px-4 text-sm font-medium" href="/app" variant="primary">
          Launch App <Arrow />
        </ButtonLink>
      </nav>

      <section className="relative mx-auto flex min-h-[calc(100vh-76px)] max-w-[1440px] flex-col items-center px-5 pt-[clamp(3rem,5vw,4.75rem)] sm:px-8 lg:px-12">
        <div className="landing-aura absolute top-[clamp(2.25rem,5vw,4.5rem)] h-40 w-40 rounded-full" />
        <OrenLogo
          attentionTargetId="launch-oren-cta"
          className="relative z-10 mb-7 h-[90px] w-[90px] sm:mb-8 sm:h-[108px] sm:w-[108px]"
          interactive
          size={108}
        />
        <div className="relative z-10 max-w-[980px] text-center">
          <h1 className="text-balance font-display text-[clamp(3rem,5.2vw,6.25rem)] font-medium leading-[0.92] tracking-[-0.07em]">
            The market never stops.<br />
            Neither does Oren.
          </h1>
          <p className="mx-auto mt-6 max-w-[530px] text-pretty text-[17px] leading-[1.5] tracking-[-0.018em] text-[#73736d] sm:text-[18px]">
            Your intelligent investing agent for researching, building and managing tokenized stock portfolios.
          </p>
          <ButtonLink className="mt-7 h-12 rounded-full px-5 text-[15px] font-medium" href="/app" id="launch-oren-cta" variant="primary">
            Launch Oren <Arrow />
          </ButtonLink>
        </div>
      </section>
    </main>
  );
}
