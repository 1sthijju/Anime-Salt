import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Anime } from '../api/types';
import { AnimeGrid } from '../components/AnimeCard';
import { Loading, CardGridSkeleton } from '../components/ui/Loading';
import { Error } from '../components/ui/Error';

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const page = Number(params.get('page') || 1);

  const [results, setResults] = useState<Anime[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setErr(null);
    setResults(null);
    (async () => {
      try {
        const data = await api.search(q, page);
        if (!cancelled) setResults(data);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [q, page]);

  if (!q) {
    return (
      <div className="text-center py-20 text-muted">
        Type something in the search bar to find anime.
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold mb-6">
        Results for <span className="text-accent">"{q}"</span>
        {results && <span className="text-muted text-base ml-3">({results.length} found)</span>}
      </h1>

      {err && <Error message={err} />}

      {results === null ? (
        <CardGridSkeleton count={12} />
      ) : results.length === 0 ? (
        <div className="text-muted text-center py-12">No anime found. Try a different search.</div>
      ) : (
        <AnimeGrid items={results} />
      )}
    </div>
  );
}