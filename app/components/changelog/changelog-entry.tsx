import Image from 'next/image';
import Link from 'next/link';
import type { ChangelogEntry as Entry } from '@/content/changelog/model.mjs';
import { formatReleaseDate } from '@/content/changelog/model.mjs';
import styles from './changelog.module.css';

export function ChangelogEntry({ entry, detail = false }: { entry: Entry; detail?: boolean }) {
  const Heading = detail ? 'h1' : 'h2';
  const ChangeHeading = detail ? 'h2' : 'h3';
  const captionId = `${entry.slug}-caption`;
  return <article className={styles.entry} aria-labelledby={`${entry.slug}-title`}>
    <time className={styles.date} dateTime={entry.date}>{formatReleaseDate(entry.date)}</time>
    <Heading id={`${entry.slug}-title`} className={styles.title}>
      {detail ? entry.title : <Link href={`/changelog/${entry.slug}`}>{entry.title}</Link>}
    </Heading>
    <div className={styles.entryMeta}>
      {(entry.sections?.length ? entry.sections.map(section => section.heading) : ['Update']).map(label => <span className={styles.releaseLabel} key={label}>{label}</span>)}
      {entry.status === 'draft' && <span className={styles.draft}>Draft preview</span>}
    </div>
    <p className={styles.summary}>{entry.summary}</p>
    {entry.sections?.map(section => <section className={styles.changes} key={section.heading} aria-label={section.heading}>
      <ul>{section.items.map((item, index) => <li key={index}>{typeof item === 'string' ? <p>{item}</p> : <><ChangeHeading>{item.title}</ChangeHeading><p>{item.description}</p></>}</li>)}</ul>
    </section>)}
    {entry.video && <figure className={styles.film}>
      <video controls playsInline preload="none" width={entry.video.width} height={entry.video.height} poster={entry.video.poster} aria-label={entry.video.label} aria-describedby={captionId}>
        <source src={entry.video.src} type="video/mp4" />
        <a href={entry.video.src}>Watch the film</a>
      </video>
      <figcaption id={captionId}>{entry.video.caption}</figcaption>
    </figure>}
    {entry.screenshots?.map(image => <figure className={styles.screenshot} key={image.src}>
      <Image src={image.src} alt={image.alt} width={image.width} height={image.height} sizes="(max-width: 767px) 100vw, 800px" unoptimized />
    </figure>)}
    <div className={styles.entryLinks}>
      {entry.links?.map(link => <Link className={styles.featureLink} key={link.href} href={link.href}>{link.label}<span aria-hidden="true">↗</span></Link>)}
      {!detail && <Link className={styles.permalink} href={`/changelog/${entry.slug}`} aria-label={`Permalink: ${entry.title}`}>Release details <span aria-hidden="true">↗</span></Link>}
    </div>
  </article>;
}
