
import { ArrowRight02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { OrenLogo } from '@/components/brand/oren-logo';
import { LandingHeader } from '@/components/landing/landing-header';
import { LandingFooter } from '@/components/landing/landing-footer';
import { ButtonLink } from '@/components/ui/button';
import { previewDrafts } from '@/content/changelog';
import styles from '@/components/changelog/changelog.module.css';

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.page} id="top">
    <LandingHeader><nav className={styles.nav} aria-label="Main navigation">
      <Link className={styles.brand} href="/" aria-label="Oren home"><OrenLogo size={28} /><span>OREN</span></Link>
      <div className={styles.navLinks}><Link href="/#product">Product</Link><Link href="/app/markets">Markets</Link><Link href="/token">Token</Link><Link href="/roadmap">Roadmap</Link><Link href="/changelog" aria-current="page">Changelog</Link></div>
      <ButtonLink className="h-10 rounded-full px-4 text-sm font-medium" href="/app" variant="primary">Launch App <HugeiconsIcon icon={ArrowRight02Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></ButtonLink>
    </nav></LandingHeader>
    <main className={styles.main}>
      {previewDrafts && <aside className={styles.previewNotice}>Local draft preview. Unpublished entries are visible only in this development server.</aside>}
      {children}
    </main>
    <LandingFooter />
  </div>;
}
