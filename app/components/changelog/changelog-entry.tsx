import Image from 'next/image';
import Link from 'next/link';
import type { ChangelogEntry as Entry } from '@/content/changelog/model.mjs';
import styles from './changelog.module.css';

export function ChangelogEntry({ entry, detail = false }: { entry: Entry; detail?: boolean }) {
  const Heading = detail ? 'h1' : 'h2';
  const captionId = `${entry.slug}-caption`;
  return <article className={styles.entry} aria-labelledby={`${entry.slug}-title`}>
    <div className={styles.entryMeta}><span className={styles.releaseLabel}><span aria-hidden="true" />Product update</span>{entry.status === 'draft' && <span className={styles.draft}>Draft preview</span>}</div>
    <Heading id={`${entry.slug}-title`} className={styles.title}>
      {detail ? entry.title : <Link href={`/changelog/${entry.slug}`}>{entry.title}</Link>}
    </Heading>
    <p className={styles.summary}>{entry.summary}</p>
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
    {entry.sections?.map(section => <section className={styles.changes} key={section.heading} aria-label={section.heading}>
      <h3>{section.heading}</h3><ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul>
    </section>)}
    <div className={styles.entryLinks}>
      {entry.links?.map(link => <Link className={styles.featureLink} key={link.href} href={link.href}>{link.label}<span aria-hidden="true">↗</span></Link>)}
      {!detail && <Link className={styles.permalink} href={`/changelog/${entry.slug}`} aria-label={`Permalink: ${entry.title}`}>Release details <span aria-hidden="true">↗</span></Link>}
    </div>
  </article>;
}
