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
            <a className={styles.social} href="https://x.com/orenfinance_" target="_blank" rel="noopener noreferrer" aria-label="Follow Oren on X (opens in a new tab)"><span aria-hidden="true">𝕏</span> Follow on X <span aria-hidden="true">↗</span></a>
            <a className={styles.social} href="https://t.me/orendotfinance" target="_blank" rel="noopener noreferrer" aria-label="Join Oren on Telegram (opens in a new tab)"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21.4 3.6 18.2 20c-.2 1.2-.9 1.5-1.9.9l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.6-.6-.2L5.6 13.8.8 12.3c-1-.3-1-1 .2-1.5L19.8 3.5c.9-.3 1.7.2 1.6.1Z" /></svg> Telegram <span aria-hidden="true">↗</span></a>
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
          <a href="#top" className={styles.backToTop}>Back to top <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg></a>
        </div>
      </div>
    </div>
  </footer>;
}
