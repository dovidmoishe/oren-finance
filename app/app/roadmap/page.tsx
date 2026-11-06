import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { OrenLogo } from '@/components/brand/oren-logo';
import { LandingHeader } from '@/components/landing/landing-header';
import { LandingFooter } from '@/components/landing/landing-footer';
import { ButtonLink } from '@/components/ui';
import { RoadmapExplorer } from './roadmap-explorer';
import landing from '@/components/landing/landing-hero.module.css';
import styles from './roadmap.module.css';
import './roadmap-motion.css';

export const metadata: Metadata = {
  title: 'Roadmap — Oren',
  description: 'What comes next for Oren. Explore MCP, developer SDKs, $OREN membership and fundamentals-focused crypto research.',
  alternates: { canonical: '/roadmap' },
  openGraph: { title: 'Roadmap — Oren', description: 'A little further ahead. Explore what we’re building at Oren.', url: '/roadmap', type: 'website' },
};

export default function RoadmapPage() {
  return <div className={styles.page} id="top">
    <div aria-hidden="true" className={landing.backdrop} />
    <LandingHeader><nav className={styles.nav} aria-label="Main navigation">
      <Link className={styles.brand} href="/" aria-label="Oren home"><OrenLogo size={28} /><span>OREN</span></Link>
      <div className={styles.navLinks}><Link href="/#product">Product</Link><Link href="/app/markets">Markets</Link><Link href="/agents">Agents</Link><Link href="/token">Token</Link><Link href="/roadmap" aria-current="page">Roadmap</Link><Link href="/changelog">Changelog</Link></div>
      <ButtonLink className="h-10 rounded-full px-4 text-sm font-medium" href="/app" variant="primary">Launch App <HugeiconsIcon icon={ArrowRight02Icon} size={16} /></ButtonLink>
    </nav></LandingHeader>
    <main className={styles.main}>
      <RoadmapExplorer />
    </main>
    <LandingFooter />
  </div>;
}
