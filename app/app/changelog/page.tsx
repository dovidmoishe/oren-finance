import type { Metadata } from 'next';
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
  return <>
    <header className={styles.intro}><h1>Changelog</h1><p>A closer look at what we’re shipping.</p></header>
    <div className={styles.feed}>
      {groups.length ? groups.map(group => <section className={styles.releaseDay} key={group.date} aria-label={`Updates for ${formatReleaseDate(group.date)}`}>
        {group.entries.map(entry => <ChangelogEntry key={entry.slug} entry={entry} />)}
      </section>) : <p className={styles.empty}>Our next update will appear here. See you soon.</p>}
    </div>
  </>;
}
