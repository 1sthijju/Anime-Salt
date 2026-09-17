import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Anime, PopularItem } from '../api/types';
import { AnimeGrid } from '../components/AnimeCard';
import { Loading, CardGridSkeleton } from '../components/ui/Loading';
import { Error } from '../components/ui/Error';

export default function Home() {
  const [latest, setLatest] = useState<Anime[] | null>(null);
  const [popular, setPopular] = useState<PopularItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setErr(null);
    try {
      const [l, p] = await Promise.all([api.latestEpisodes(), api.popular()]);
      setLatest(l);
      setPopular(p);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-12 animate-fade-in">
      {/* Hero */}
      <section className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-violet-900/40 via-bg to-cyan-900/30 p-8 md:p-12 border border-border">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Watch Anime,{' '}
          <span className="bg-gradient-to-r from-accent to-accent2 bg-clip-text text-transparent">
            Ad-Free.
          </span>
        </h1>
        <p className="text-gray-300 max-w-xl leading-relaxed">
          Stream thousands of episodes in 4K HDR with Movi Player — HLS & MP4 streaming,
          multi-language audio, and zero transcoding.
        </p>
      </section>

      {err && <Error message={err} onRetry={load} />}

      {/* Latest */}
      <section>
        <h2 className="text-xl font-semibold mb-4">🔥 Latest Episodes</h2>
        {latest ? <AnimeGrid items={latest} /> : <CardGridSkeleton count={12} />}
      </section>

      {/* Popular */}
      <section>
        <h2 className="text-xl font-semibold mb-4">🏆 Popular</h2>
        {popular ? <AnimeGrid items={popular.slice(0, 18)} /> : <CardGridSkeleton count={12} />}
      </section>
    </div>
  );
}