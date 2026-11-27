import type { Metadata } from 'next';
import { ChangelogEntry } from '@/components/changelog/changelog-entry';
import { getChangelogGroups, previewDrafts } from '@/content/changelog';
import { formatReleaseDate } from '@/content/changelog/model.mjs';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Changelog',
  description: 'The latest releases, improvements, and films from Oren.',
  path: '/changelog',
  ...(previewDrafts ? { robots: { index: false, follow: false } } : {}),
});

export default function ChangelogPage() {
  const groups = getChangelogGroups();
  const firstVideoSlug = groups.flatMap(group => group.entries).find(entry => entry.video)?.slug;
  return <>
    <header className="changelog-intro"><h1>Changelog</h1><p>A closer look at what we’re shipping.</p></header>
    <div className="pt-[38px] at-most-767:pt-[28px]">
      {groups.length ? groups.map(group => <section className="changelog-release-day" key={group.date} aria-label={`Updates for ${formatReleaseDate(group.date)}`}>
        {group.entries.map(entry => <ChangelogEntry key={entry.slug} entry={entry} deferPoster={entry.slug !== firstVideoSlug} />)}
      </section>) : <p className="text-[14px] text-[#69665f] pb-[50px]">Our next update will appear here. See you soon.</p>}
    </div>
  </>;
}
