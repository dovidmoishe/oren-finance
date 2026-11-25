
import { ArrowLeft as ArrowLeftIcon } from "lucide-react";

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChangelogEntry } from '@/components/changelog/changelog-entry';
import { getChangelog, getChangelogEntry } from '@/content/changelog';
import { JsonLd } from '@/components/seo/json-ld';
import { DEFAULT_OG_IMAGE, changelogJsonLd, pageMetadata } from '@/lib/seo';

type Props = { params: Promise<{ slug: string }> };
type Entry = NonNullable<ReturnType<typeof getChangelogEntry>>;

export function generateStaticParams() { return getChangelog().map(entry => ({ slug: entry.slug })); }

/** The film poster or first screenshot. Entries without media use the site image. */
function socialImage(entry: Entry) {
  const screenshot = entry.screenshots?.[0];
  if (entry.video) return { url: entry.video.poster, alt: entry.title };
  return screenshot ? { url: screenshot.src, width: screenshot.width, height: screenshot.height, alt: entry.title } : undefined;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const entry = getChangelogEntry((await params).slug);
  if (!entry) notFound();
  if (entry.status === 'draft') return { title: 'Draft preview', robots: { index: false, follow: false } };
  return pageMetadata({
    title: entry.title,
    description: entry.summary,
    path: `/changelog/${entry.slug}`,
    image: socialImage(entry) ?? DEFAULT_OG_IMAGE,
    socialTitle: entry.title,
    article: { publishedTime: `${entry.date}T12:00:00Z` },
  });
}

export default async function EntryPage({ params }: Props) {
  const entry = getChangelogEntry((await params).slug);
  if (!entry) notFound();
  return <>
    {entry.status === 'published' && <JsonLd data={changelogJsonLd({ ...entry, image: socialImage(entry)?.url })} />}
    <Link href="/changelog" className="inline-flex gap-[10px] items-center min-h-[44px] text-[12px] text-[#69665f] [margin:28px_0]"><span aria-hidden="true"><ArrowLeftIcon size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span>All updates</Link>
    <div className="[border-top:1px_solid_#e3e0d9] pt-[34px] at-most-767:pt-[28px]">
      <ChangelogEntry entry={entry} detail />
    </div>
  </>;
}
