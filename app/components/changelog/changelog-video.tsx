'use client';

import { useEffect, useRef, type ComponentPropsWithoutRef } from 'react';

export function ChangelogVideo({ poster, deferPoster = false, ...props }: ComponentPropsWithoutRef<'video'> & { deferPoster?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!deferPoster || !poster || !video) return;

    if (typeof IntersectionObserver === 'undefined') {
      video.poster = poster;
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        video.poster = poster;
        observer.disconnect();
      }
    }, { rootMargin: '100% 0px' });
    observer.observe(video);
    return () => observer.disconnect();
  }, [deferPoster, poster]);

  return <video {...props} ref={ref} poster={deferPoster ? undefined : poster} />;
}
