import { useCallback, useEffect, useState } from 'react';

export interface ResumeEntry {
  slug: string;
  time: number;
  duration: number;
  saved: number;
  title?: string;
}

const PREFIX = 'resume:';

export function useContinueWatching() {
  const [entries, setEntries] = useState<ResumeEntry[]>([]);

  const refresh = useCallback(() => {
    try {
      const items: ResumeEntry[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(PREFIX)) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const { time, duration, saved, title } = JSON.parse(raw);
        if (!duration || time < 10) continue;
        if (time / duration > 0.95) continue; // finished — hide
        items.push({ slug: key.slice(PREFIX.length), time, duration, saved, title });
      }
      items.sort((a, b) => b.saved - a.saved);
      setEntries(items.slice(0, 12));
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const onVis = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [refresh]);

  const remove = useCallback(
    (slug: string) => {
      localStorage.removeItem(PREFIX + slug);
      refresh();
    },
    [refresh]
  );

  const clearAll = useCallback(() => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    refresh();
  }, [refresh]);

  return { entries, remove, clearAll };
}