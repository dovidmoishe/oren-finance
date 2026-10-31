import type { Metadata } from "next";
import Link from "next/link";
import { OrenLogo } from "@/components/brand/oren-logo";
import { LandingHeader } from "@/components/landing/landing-header";
import { LandingFooter } from "@/components/landing/landing-footer";
import styles from "./token.module.css";
import { TokenArt, ArrowIcon } from "./token-art";
import { TokenAddress } from "./token-address";
import landingStyles from "@/components/landing/landing-hero.module.css";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = {
  title: "$OREN — Holder access & token utility",
  description: "See what we are building for $OREN: holding-based access, member benefits, and automated fee-funded buybacks and burns.",
};

const questions = [
  ["What is $OREN for?", "We are building holding-based membership tiers. Your $OREN holdings will determine access to platform features and usage allowances. We will publish the benefits and holding requirements before access goes live."],
  ["Are holder benefits available now?", "Holder access and membership tiers are in development. Holding $OREN does not unlock these benefits yet. We will publish the features, usage allowances and holding requirements before activation."],
  ["Will I hold tokens or spend them?", "Membership is being built around holding $OREN, without spending your tokens on access or paying an extra subscription. Trading and network fees are separate. Creator fees from $OREN trading already help fund Oren’s API and infrastructure costs."],
  ["How do buybacks and burns fit in?", "We are building an automated system that uses a share of Oren’s platform fees to buy $OREN and permanently remove the purchased tokens from circulation through burns. This system is not active yet. We will publish the fee allocation and execution rules before activation, and transaction records once it goes live."],
  ["Is $OREN the same as the stocks in Oren?", "$OREN is Oren’s own token on Solana. It is separate from the tokenized stocks you research and trade in the app. The address above identifies $OREN; each supported stock has its own token details in Markets."],
  ["How can I follow delivery?", "We are shipping product updates and building holder access alongside the buyback-and-burn system. This page will carry access requirements, rollout updates and onchain receipts as each part goes live."],
];

export default function TokenPage() {
  return <div className={styles.page} id="top">
    <div aria-hidden="true" className={landingStyles.backdrop} />
    <LandingHeader>
      <nav className={styles.nav} aria-label="Main navigation">
        <Link className={styles.brand} href="/" aria-label="Oren home"><OrenLogo size={28} /><span>OREN</span></Link>
        <div className={styles.navLinks}><Link href="/#product">Product</Link><Link href="/#stock-mix">Stock mix</Link><Link href="/app/markets">Markets</Link><Link href="/token" aria-current="page">Token</Link></div>
        <ButtonLink className="h-10 rounded-full px-4 text-sm font-medium" href="/app" variant="primary">Launch App <ArrowIcon /></ButtonLink>
      </nav>
    </LandingHeader>
    <main className={styles.main}>
      <section className={styles.hero} aria-labelledby="token-heading">
        <div className={styles.heroCopy}>
          <h1 id="token-heading">A product that grows.<br /><span>A token with a role.</span></h1>
          <p>$OREN is Oren’s token on Solana. We are building membership access, holder benefits, and automated buybacks and burns around the product.</p>
          <TokenAddress />
          <a className={styles.textLink} href="#token-film">Watch the story · 36 sec <ArrowIcon direction="down" /></a>
        </div>
        <div className={styles.heroArt} aria-hidden="true"><div className={landingStyles.aura} /><div className={landingStyles.ground} /><div className={styles.coin}><div className={styles.mascot}><OrenLogo size={150} /></div></div><span className={styles.tokenLabel}>$OREN <span>ON SOLANA</span></span></div>
      </section>

      <section className={styles.film} id="token-film" aria-labelledby="film-heading">
        <div className={styles.filmHeading}><h2 id="film-heading">The idea, in 36 seconds.</h2><span>$OREN, explained.</span></div>
        <video className={styles.filmPlayer} controls playsInline preload="none" poster="/videos/oren-token-poster.jpg" width={1920} height={1080} aria-label="Oren token utility explainer" aria-describedby="film-description">
          <source src="/videos/oren-token-explainer.mp4" type="video/mp4" />
          <a href="/videos/oren-token-explainer.mp4">Watch the Oren token explainer</a>
        </video>
        <p id="film-description" className={styles.filmCaption}>Holder access, member benefits, and the buyback &amp; burn system we are building.</p>
      </section>

      <section className={styles.section} id="utility" aria-labelledby="utility-heading">
        <div className={styles.sectionHeading}><h2 id="utility-heading">Utility starts with use.</h2><span className={styles.badge}>In development</span></div>
        <div className={styles.utilities}>
          <article><div className={styles.accessArt}><TokenArt kind="access" /></div><h3>Hold to unlock.</h3><p>Membership built around holding $OREN, without spending it on access or paying an extra subscription.</p></article>
          <article><div className={styles.benefitsArt}><TokenArt kind="benefits" /></div><h3>More from Oren.</h3><p>Membership tiers will offer features and usage allowances. Benefits and holding requirements will be published before launch.</p></article>
          <article><div className={styles.burnArt}><TokenArt kind="burn" /></div><h3>Support what’s next.</h3><p>Creator fees from $OREN trading already help fund Oren’s API and infrastructure.</p></article>
        </div>
      </section>

      <section className={styles.flywheel} id="flywheel" aria-labelledby="flywheel-heading">
        <div className={styles.sectionHeading}><h2 id="flywheel-heading">How product fees will support $OREN.</h2><span className={styles.badge}>In development</span></div>
        <div className={styles.flow}>
          <div className={styles.flowStart}><div className={styles.flowMascot} aria-hidden="true"><OrenLogo size={64} /></div><h3>People use Oren</h3><p>Research. Build. Trade.</p></div>
          <span className={styles.connector}><ArrowIcon /></span>
          <div className={styles.fees}><h3>Platform fees</h3></div>
          <div className={styles.branches}>
            <article className={styles.operation}><div className={styles.miniArt}><TokenArt kind="benefits" /></div><h3>Fund the product</h3><p>Infrastructure. Features. Improvements.</p></article>
            <article className={styles.burn}><div className={styles.miniArt}><TokenArt kind="burn" /></div><h3>Buy $OREN. Burn it.</h3><p>A share of fees buys tokens to burn.</p></article>
          </div>
        </div>
        <div className={styles.holding}><ArrowIcon /><p><strong>Membership will be based on $OREN holdings.</strong></p></div>
        <p className={styles.flowNote}>This is the platform-fee model we are building. Automated buybacks and burns are not active yet. Fee allocation and execution rules will be published before activation.</p>
      </section>

      <section className={`${styles.section} ${styles.rollout}`} aria-labelledby="rollout-heading">
        <div><h2 id="rollout-heading">What we are building.</h2><Link className={styles.textLink} href="/app">Explore the product <ArrowIcon direction="diagonal" /></Link></div>
        <ol className={styles.milestones}>
          <li><div><h3>Membership tiers & benefits</h3></div><span className={styles.badge}>In development</span></li>
          <li><div><h3>Buyback & burn rules</h3></div><span className={styles.badge}>In development</span></li>
          <li><div><h3>Public buyback & burn transactions</h3></div><span className={styles.badge}>In development</span></li>
        </ol>
      </section>

      <section className={`${styles.section} ${styles.faq}`} id="token-faq" aria-labelledby="faq-heading">
        <h2 id="faq-heading">A little more clarity.</h2>
        <div>{questions.map(([question, answer]) => <details key={question} className={styles.question}><summary>{question}<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg></summary><p>{answer}</p></details>)}</div>
      </section>
      <section className={styles.closing} aria-labelledby="closing-heading"><h2 id="closing-heading">It starts with a useful product.</h2><ButtonLink className="h-12 rounded-full px-5 text-[14px] font-medium" href="/app" variant="primary">Launch Oren <ArrowIcon /></ButtonLink></section>
    </main>
    <LandingFooter />
  </div>;
}
