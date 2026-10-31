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
    <header className={styles.intro}><span className={styles.eyebrow}>THE LATEST AT OREN</span><h1>Always building.</h1><p>New releases, small improvements, and the stories behind what we ship.</p></header>
    {groups.length ? groups.map((group, index) => <section className={styles.group} key={group.date} aria-label={`Updates for ${formatReleaseDate(group.date)}`}>
      <div className={styles.date}><time dateTime={group.date}>{formatReleaseDate(group.date)}</time>{index === 0 && <span className={styles.dateLabel}>Latest release</span>}</div>
      <div>{group.entries.map(entry => <ChangelogEntry key={entry.slug} entry={entry} />)}</div>
    </section>) : <p className={styles.empty}>Our next update will appear here. See you soon.</p>}
  </>;
}
