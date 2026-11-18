
import { Plus as PlusIcon } from "lucide-react";
import { landingHeroClasses } from "@/components/landing/landing-hero-classes";

import type { Metadata } from "next";
import Link from "next/link";
import { OrenLogo } from "@/components/brand/oren-logo";
import { LandingHeader } from "@/components/landing/landing-header";
import { LandingFooter } from "@/components/landing/landing-footer";
import { TokenArt, ArrowIcon } from "./token-art";
import { TokenAddress } from "./token-address";
import { ButtonLink } from "@/components/ui";

const tokenBadgeClass = "text-[10px] text-[#85796a] [border:1px_solid_#e4e0d8] rounded-[999px] [padding:5px_10px] whitespace-nowrap";

const tokenSectionHeadingClass = "flex items-center justify-between gap-[20px] at-most-600:items-start at-most-600:flex-col at-most-600:gap-[12px]";

const tokenTextLinkClass = "inline-flex gap-[24px] items-center min-h-[44px] text-[12px] mt-[18px]";

export const metadata: Metadata = {
  title: "$OREN — Holder access & token utility",
  description: "Explore $OREN on Solana, its official token address, and the holder access and membership benefits we are building.",
};

const questions = [
  ["What is $OREN for?", "We are building holding-based membership tiers. Your $OREN holdings will determine access to platform features and usage allowances. We will publish the benefits and holding requirements before access goes live."],
  ["Are holder benefits available now?", "Holder access and membership tiers are in development. Holding $OREN does not unlock these benefits yet. We will publish the features, usage allowances and holding requirements before activation."],
  ["Will I hold tokens or spend them?", "Membership is being built around holding $OREN, without spending your tokens on access or paying an extra subscription. Trading and network fees are separate. Creator fees from $OREN trading already help fund Oren’s API and infrastructure costs."],
  ["Is $OREN the same as the stocks in Oren?", "$OREN is Oren’s own token on Solana. It is separate from the tokenized stocks you research and trade in the app. The address above identifies $OREN; each supported stock has its own token details in Markets."],
  ["How can I follow delivery?", "We are shipping product updates and building holder access. This page will carry membership benefits, holding requirements and rollout updates as each part goes live."],
];

export default function TokenPage() {
  return <div className="token-page" id="top">
    <div aria-hidden="true" className="landing-backdrop" />
    <LandingHeader>
      <nav className="token-nav" aria-label="Main navigation">
        <Link className="flex items-center gap-[10px] text-[15px] font-semibold tracking-[.16em] at-most-600:text-[12px] at-most-600:gap-[7px]" href="/" aria-label="Oren home"><OrenLogo size={28} /><span>OREN</span></Link>
        <div className="token-nav-links"><Link href="/#product">Product</Link><Link href="/app/markets">Markets</Link><Link href="/token" aria-current="page">Token</Link><Link href="/roadmap">Roadmap</Link><Link href="/changelog">Changelog</Link></div>
        <ButtonLink className="h-10 rounded-full px-4 text-sm font-medium" href="/app" variant="primary">Launch App <ArrowIcon /></ButtonLink>
      </nav>
    </LandingHeader>
    <main className="token-main">
      <section className="token-hero" aria-labelledby="token-heading">
        <div className="token-hero-copy">
          <h1 id="token-heading">A product that grows.<br /><span>A token with a role.</span></h1>
          <p>$OREN is Oren’s token on Solana. We are building membership access and holder benefits around the product.</p>
          <TokenAddress />
        </div>
        <div className="token-hero-art" aria-hidden="true"><div className={landingHeroClasses.aura} /><div className={landingHeroClasses.ground} /><div className="token-coin"><div className="token-mascot"><OrenLogo size={150} /></div></div><span className="token-token-label">$OREN <span>ON SOLANA</span></span></div>
      </section>

      <section className="token-section" id="utility" aria-labelledby="utility-heading">
        <div className={tokenSectionHeadingClass}><h2 id="utility-heading">Utility starts with use.</h2><span className={tokenBadgeClass}>In development</span></div>
        <div className="token-utilities">
          <article><div className="token-access-art"><TokenArt kind="access" /></div><h3>Hold to unlock.</h3><p>Membership built around holding $OREN, without spending it on access or paying an extra subscription.</p></article>
          <article><div className="token-benefits-art"><TokenArt kind="benefits" /></div><h3>More from Oren.</h3><p>Membership tiers will offer features and usage allowances. Benefits and holding requirements will be published before launch.</p></article>
          <article><div className="token-burn-art"><TokenArt kind="burn" /></div><h3>Support what’s next.</h3><p>Creator fees from $OREN trading already help fund Oren’s API and infrastructure.</p></article>
        </div>
      </section>

      <section className="token-section token-rollout" aria-labelledby="rollout-heading">
        <div><h2 id="rollout-heading">What we are building.</h2><Link className={tokenTextLinkClass} href="/app">Explore the product <ArrowIcon direction="diagonal" /></Link></div>
        <ol className="token-milestones">
          <li><div><h3>Membership tiers & benefits</h3></div><span className={tokenBadgeClass}>In development</span></li>
        </ol>
      </section>

      <section className="token-section token-faq" id="token-faq" aria-labelledby="faq-heading">
        <h2 id="faq-heading">A little more clarity.</h2>
        <div>{questions.map(([question, answer]) => <details key={question} className="token-question"><summary>{question}<PlusIcon size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></summary><p>{answer}</p></details>)}</div>
      </section>
      <section className="token-closing" aria-labelledby="closing-heading"><h2 id="closing-heading">It starts with a useful product.</h2><ButtonLink className="h-12 rounded-full px-5 text-[14px] font-medium" href="/app" variant="primary">Launch Oren <ArrowIcon /></ButtonLink></section>
    </main>
    <LandingFooter />
  </div>;
}
