import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { HomeData } from '../api/types';
import { Hero } from '../components/ui/Hero';
import { SectionRail } from '../components/ui/SectionRail';
import { RailSkeleton } from '../components/ui/Skeletons';

export default function Home() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setData(null);
    api
      .home()
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="container-x py-32 text-center">
        <p className="text-sm text-red-400">Failed to load home feed: {error}</p>
        <button className="btn-ghost mt-4" onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <Hero item={data?.mostWatchedSeries?.[0] ?? null} loading={!data} />

      {!data ? (
        <>
          <RailSkeleton />
          <RailSkeleton />
          <RailSkeleton />
        </>
      ) : (
        <>
          <SectionRail title="Latest Updates" items={data.latest} href="/browse/series" />
          <SectionRail title="Most-Watched Series" items={data.mostWatchedSeries} ranked />
          <SectionRail title="Most-Watched Films" items={data.mostWatchedFilms} ranked href="/browse/movies" />
          <SectionRail title="On-Air Series" items={data.onAirSeries?.length ? data.onAirSeries : data.ongoing} />
          <SectionRail title="Fresh Drops" items={data.freshDrops} />
          <SectionRail title="New Anime Arrivals" items={data.newAnimeArrivals} />
          <SectionRail title="Latest Anime Movies" items={data.animeMovies?.length ? data.animeMovies : data.movies} href="/browse/movies" />
          <SectionRail title="Just In: Cartoon Series" items={data.cartoonSeries} href="/browse/cartoon" />
          <SectionRail title="Fresh Cartoon Films" items={data.cartoonFilms} href="/browse/cartoon" />
          <SectionRail title="Completed & Binge-Ready" items={data.completed} />
        </>
      )}
    </div>
  );
}