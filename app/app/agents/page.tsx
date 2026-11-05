import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { OrenLogo } from '@/components/brand/oren-logo';
import { LandingHeader } from '@/components/landing/landing-header';
import { LandingFooter } from '@/components/landing/landing-footer';
import { ButtonLink } from '@/components/ui';
import landing from '@/components/landing/landing-hero.module.css';
import { AgentSetup } from './agent-setup';
import styles from './agents.module.css';

export const metadata: Metadata = {
  title: 'Connect your agent — Oren',
  description: 'Connect Claude, Cursor or Codex to Oren. Your agent researches and trades tokenized stocks inside limits you set and sign.',
  alternates: { canonical: '/agents' },
  openGraph: { title: 'Connect your agent — Oren', description: 'Trade tokenized stocks from Claude, Cursor or Codex, inside limits you set.', url: '/agents', type: 'website' },
};

const STEPS = [
  { title: 'Sign in to Oren', body: 'Use your email. Oren creates a Solana wallet for your account.', link: { href: '/app', label: 'Sign in' } },
  { title: 'Add money', body: 'Deposit USDC from the account menu. Your agent can only use what’s in your wallet.' },
  { title: 'Set your limits', body: 'In Agent connections, choose a per-trade and daily limit and approve them with your wallet. Skip this and your agent can still prepare trades for you to review.', link: { href: '/settings/mcp', label: 'Agent connections' } },
  { title: 'Add Oren to your agent', body: 'Pick your app below and follow the steps. It takes about a minute.', link: { href: '#setup', label: 'Setup steps' } },
  { title: 'Ask it to trade', body: 'Under your limit, it trades. Above it, the trade waits for you to review in Oren.' },
];

const SAFEGUARDS = [
  { title: 'Your limits are signed', body: 'Per-trade and daily limits are approved with your wallet, and Oren checks them again before every trade.' },
  { title: 'Capped by design', body: 'Even at the maximum, chat trading stops at $25 per trade and $50 per day. Grants expire within 24 hours.' },
  { title: 'Two keys to sign', body: 'Every chat trade needs two independent approvals before it reaches your wallet.' },
  { title: 'Off in one click', body: 'Revoke an app or your limits anytime in Agent connections. It stops immediately.' },
];

const FAQ = [
  { q: 'Do I give my agent a key or password?', a: 'No. Your app opens Oren’s sign-in page, you sign in with your email and approve what it can do. Oren never asks for your seed phrase or private key.' },
  { q: 'What can my agent do without limits set?', a: 'It can read your portfolio, look up stocks and prepare buys or sells. You review and confirm each one in Oren before anything is sent.' },
  { q: 'Can it trade more than my limit?', a: 'No. Trades above your per-trade or daily limit wait for you to review in Oren instead.' },
  { q: 'Which stocks can it trade?', a: 'Any tokenized stock you can trade in Oren, buying or selling against USDC.' },
  { q: 'How do I disconnect?', a: 'Open Agent connections and revoke the app. You can also turn off chat trading there.' },
];

export default function AgentsPage() {
  return <div className={styles.page} id="top">
    <div aria-hidden="true" className={landing.backdrop} />
    <LandingHeader><nav className={styles.nav} aria-label="Main navigation">
      <Link className={styles.brand} href="/" aria-label="Oren home"><OrenLogo size={28} /><span>OREN</span></Link>
      <div className={styles.navLinks}><Link href="/#product">Product</Link><Link href="/app/markets">Markets</Link><Link href="/agents" aria-current="page">Agents</Link><Link href="/roadmap">Roadmap</Link><Link href="/changelog">Changelog</Link></div>
      <ButtonLink className="h-10 rounded-full px-4 text-sm font-medium" href="/app" variant="primary">Launch App <HugeiconsIcon icon={ArrowRight02Icon} size={16} /></ButtonLink>
    </nav></LandingHeader>
    <main className={styles.main}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Oren for AI agents</p>
        <h1>Trade from the AI app <span>you already use.</span></h1>
        <p className={styles.lede}>Connect Claude, Cursor or Codex to Oren. Your agent researches stocks, checks your portfolio and places trades, inside limits you set and sign.</p>
        <div className={styles.heroActions}>
          <ButtonLink className="h-11 rounded-full px-5 text-sm font-medium" href="#setup" variant="primary">Connect your agent <HugeiconsIcon icon={ArrowRight02Icon} size={16} /></ButtonLink>
          <Link className={styles.textLink} href="#how">How it works</Link>
        </div>
        <ul aria-label="Supported apps" className={styles.clients}>
          <li>Claude</li><li>Cursor</li><li>Codex</li>
        </ul>
      </section>

      <section aria-labelledby="how-title" className={styles.section} id="how">
        <h2 id="how-title">Up and running in five steps</h2>
        <ol className={styles.steps}>
          {STEPS.map((step, index) => <li className={styles.step} key={step.title}>
            <span className={styles.stepNumber}>{String(index + 1).padStart(2, '0')}</span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              {step.link ? <Link className={styles.stepLink} href={step.link.href}>{step.link.label} <HugeiconsIcon icon={ArrowRight02Icon} size={14} aria-hidden="true" /></Link> : null}
            </div>
          </li>)}
        </ol>
      </section>

      <section aria-labelledby="setup-title" className={styles.section} id="setup">
        <h2 id="setup-title">Add Oren to your agent</h2>
        <p className={styles.sectionLede}>Choose the app you use. You&apos;ll sign in to Oren once, and your app remembers it.</p>
        <AgentSetup />
      </section>

      <section aria-labelledby="ask-title" className={styles.section}>
        <h2 id="ask-title">Then just ask</h2>
        <div className={styles.chat}>
          <p className={styles.you}>Buy $5 of NVIDIA.</p>
          <p className={styles.agent}>Done. Bought 0.024 NVDA for $5.00 within your $25 per-trade limit. You have $45.00 left today.</p>
          <p className={styles.you}>Sell all my Tesla.</p>
          <p className={styles.agent}>That&apos;s $82.10, above your limit, so I&apos;ve prepared it for you to review in Oren.</p>
        </div>
        <p className={styles.caption}>Example conversation. Prices and amounts are illustrative.</p>
      </section>

      <section aria-labelledby="safe-title" className={styles.section}>
        <h2 id="safe-title">Your limits are the contract</h2>
        <div className={styles.safeguards}>
          {SAFEGUARDS.map(item => <div className={styles.safeguard} key={item.title}><h3>{item.title}</h3><p>{item.body}</p></div>)}
        </div>
      </section>

      <section aria-labelledby="faq-title" className={styles.section}>
        <h2 id="faq-title">Questions</h2>
        <div className={styles.faq}>
          {FAQ.map(item => <details key={item.q}><summary>{item.q}</summary><p>{item.a}</p></details>)}
        </div>
      </section>

      <section className={styles.cta}>
        <h2>Bring your agent to the market.</h2>
        <p>Sign in, set your limits, and connect the app you already use.</p>
        <ButtonLink className="h-11 rounded-full px-5 text-sm font-medium" href="/app" variant="primary">Launch App <HugeiconsIcon icon={ArrowRight02Icon} size={16} /></ButtonLink>
      </section>
    </main>
    <LandingFooter />
  </div>;
}
