import { useCallback } from 'react';

const KEY_PREFIX = 'animesalt:resume:';

export function useResume(slug: string) {
  const key = KEY_PREFIX + slug;

  const save = useCallback(
    (currentTime: number, duration: number) => {
      if (currentTime < 10 || !duration) return;
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            time: Math.floor(currentTime),
            duration: Math.floor(duration),
            savedAt: Date.now(),
          })
        );
      } catch {}
    },
    [key]
  );

  const load = useCallback((): number | null => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { time, savedAt } = JSON.parse(raw);
      // Expire after 30 days
      if (Date.now() - savedAt > 1000 * 60 * 60 * 24 * 30) {
        localStorage.removeItem(key);
        return null;
      }
      return time;
    } catch {
      return null;
    }
  }, [key]);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {}
  }, [key]);

  return { save, load, clear };
}