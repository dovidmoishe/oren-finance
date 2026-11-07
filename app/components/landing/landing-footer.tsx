
import { NewTwitterIcon, ArrowUpRight01Icon, TelegramIcon, ArrowUp02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from "next/link";
import Image from "next/image";
import { OrenLogo } from "@/components/brand/oren-logo";
import styles from "./landing-footer.module.css";

const groups = [
  { title: "Product", links: [
    { label: "Overview", href: "/#product" },
    { label: "Stock mix", href: "/#stock-mix" },
    { label: "How it works", href: "/#how-it-works" },
  ] },
  { title: "Terminal", links: [
    { label: "Markets", href: "/app/markets" },
    { label: "Portfolio", href: "/app/portfolio" },
    { label: "Activity", href: "/app/activity" },
  ] },
  { title: "Resources", links: [
    { label: "Connect your agent", href: "/agents" },
    { label: "Roadmap", href: "/roadmap" },
    { label: "Changelog", href: "/changelog" },
    { label: "Token", href: "/token" },
    { label: "Integrations", href: "/#features" },
    { label: "FAQ", href: "/#faq" },
    { label: "Launch Oren", href: "/app" },
  ] },
];

export function LandingFooter() {
  return <footer className={styles.footer} id="footer">
    <div className={styles.inner}>
      <div className={styles.top}>
        <div className={styles.brand}>
          <Link href="/" className={styles.wordmark} aria-label="Oren home"><span aria-hidden="true"><OrenLogo size={30} /></span><span>OREN</span></Link>
          <p>AI-powered trading for tokenized stocks on Solana.</p>
          <div className={styles.socialLinks}>
            <a className={styles.social} href="https://x.com/orenfinance_" target="_blank" rel="noopener noreferrer" aria-label="Follow Oren on X (opens in a new tab)"><span aria-hidden="true"><HugeiconsIcon icon={NewTwitterIcon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span> Follow on X <span aria-hidden="true"><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></a>
            <a className={styles.social} href="https://t.me/orendotfinance" target="_blank" rel="noopener noreferrer" aria-label="Join Oren on Telegram (opens in a new tab)"><HugeiconsIcon icon={TelegramIcon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /> Telegram <span aria-hidden="true"><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></a>
          </div>
        </div>
        <nav className={styles.navigation} aria-label="Footer navigation">
          {groups.map(group => <div key={group.title}>
            <h3>{group.title}</h3>
            <ul>{group.links.map(link => <li key={link.label}>
              {link.href.startsWith("#") ? <a href={link.href}>{link.label}</a> : <Link href={link.href}>{link.label}</Link>}
            </li>)}</ul>
          </div>)}
        </nav>
      </div>
      <div className={styles.bottom}>
        <p>© {new Date().getFullYear()} Oren</p>
        <div className={styles.meta}>
          <span className={styles.solana}>Built on <Image src="/integrations/solana.svg" alt="" width={15} height={12} /><span>Solana</span></span>
          <a href="#top" className={styles.backToTop}>Back to top <HugeiconsIcon icon={ArrowUp02Icon} size={14} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></a>
        </div>
      </div>
    </div>
  </footer>;
}
