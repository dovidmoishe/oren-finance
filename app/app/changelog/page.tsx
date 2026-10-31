import type { Metadata } from 'next';
import { OrenLogo } from '@/components/brand/oren-logo';
import { ChangelogEntry } from '@/components/changelog/changelog-entry';
import { getChangelogGroups, previewDrafts } from '@/content/changelog';
import { formatReleaseDate } from '@/content/changelog/model.mjs';
import styles from '@/components/changelog/changelog.module.css';

export const metadata: Metadata = {
  title: 'Changelog — Oren',
  description: 'The latest releases, improvements, and films from Oren.',
  alternates: { canonical: '/changelog' },
  openGraph: { title: 'Changelog — Oren', description: 'The latest releases, improvements, and films from Oren.', url: '/changelog', type: 'website' },
  ...(previewDrafts ? { robots: { index: false, follow: false } } : {}),
};

export default function ChangelogPage() {
  const groups = getChangelogGroups();
  const archive = new Map<string, { key: string; label: string }[]>();
  for (const { date } of groups) {
    const year = date.slice(0, 4);
    const key = date.slice(0, 7);
    const months = archive.get(year) ?? [];
    if (!months.some(month => month.key === key)) {
      months.push({ key, label: new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)) });
    }
    archive.set(year, months);
  }
  return <>
    <header className={styles.intro}>
      <div className={styles.heroArt} aria-hidden="true">
        <svg viewBox="0 0 180 120" fill="none"><path d="m18 83 70-37 74 37-70 37z" stroke="currentColor" /><path d="m30 77 58-31 62 31-58 31zM18 89l74 37 70-37" stroke="currentColor" /><path d="M88 46V24l40 20v22M88 24l-23 12v22" stroke="currentColor" /><path d="m65 36 40 20 23-12M105 56v23" stroke="#ac8cc5" strokeWidth="1.5" /><path d="m49 67 39-21 42 21-39 22z" fill="#eee6f5" stroke="#b59acb" /></svg>
        <span className={styles.heroMark}><OrenLogo size={45} /></span>
      </div>
      <div className={styles.heroCopy}><h1>What’s new?</h1><p>The latest releases and improvements at Oren.</p></div>
    </header>
    <div className={styles.feedLayout}>
      {archive.size > 0 && <nav className={styles.archive} aria-label="Release archive">
        {Array.from(archive, ([year, months]) => <section key={year}><h2>{year}</h2><ul>{months.map(month => <li key={month.key}><a href={`#month-${month.key}`} data-latest={month.key === groups[0].date.slice(0, 7) ? 'true' : undefined}>{month.label}</a></li>)}</ul></section>)}
      </nav>}
      <div className={styles.feed}>
        {groups.length ? groups.map((group, index) => <section className={styles.releaseDay} key={group.date} id={index === 0 || groups[index - 1].date.slice(0, 7) !== group.date.slice(0, 7) ? `month-${group.date.slice(0, 7)}` : undefined} aria-label={`Updates for ${formatReleaseDate(group.date)}`}>
          {group.entries.map(entry => <ChangelogEntry key={entry.slug} entry={entry} />)}
        </section>) : <p className={styles.empty}>Our next update will appear here. See you soon.</p>}
      </div>
    </div>
  </>;
}
