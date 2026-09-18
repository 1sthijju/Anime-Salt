import { useCallback } from 'react';

const KEY_PREFIX = 'resume:';

export interface ResumeMeta {
  title?: string;
}

export function useResume(slug: string) {
  const key = `${KEY_PREFIX}${slug}`;

  const save = useCallback(
    (currentTime: number, duration: number, meta?: ResumeMeta) => {
      if (!duration || currentTime < 10) return;
      const data = { time: currentTime, duration, saved: Date.now(), title: meta?.title };
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch {}
    },
    [key]
  );

  const load = useCallback(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { time, saved } = JSON.parse(raw);
      const age = Date.now() - saved;
      const maxAge = 14 * 24 * 60 * 60 * 1000;
      return age < maxAge ? time : null;
    } catch {
      return null;
    }
  }, [key]);

  return { save, load };
}