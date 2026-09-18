import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { CardItem } from '../api/types';
import { PosterGrid } from '../components/ui/PosterGrid';

export default function Search() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const [items, setItems] = useState<CardItem[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(
    async (q: string, pageNum: number, append = false) => {
      if (!q.trim()) {
        setItems([]);
        return;
      }
      setLoading(true);
      try {
        const data = await api.search(q, pageNum);
        if (data.length < 20) setHasMore(false);
        setItems((prev) => (append ? [...prev, ...data] : data));
      } catch (e) {
        console.error('Search error:', e);
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    setItems([]);
    setPage(1);
    setHasMore(true);
    load(query, 1);
  }, [query, load]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    load(query, next, true);
  };

  return (
    <div className="container-x py-10">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-extrabold sm:text-4xl">
          Search Results
        </h1>
        <p className="mt-2 text-sm text-muted">
          {query ? (
            <>
              Showing results for <span className="text-white">"{query}"</span>
            </>
          ) : (
            'Enter a search term to find anime, movies, or cartoons.'
          )}
        </p>
      </div>

      <PosterGrid
        items={items}
        loading={loading && items.length === 0}
        empty={query ? `No results for "${query}"` : undefined}
      />

      {hasMore && items.length > 0 && (
        <div className="mt-12 flex justify-center">
          <button onClick={loadMore} disabled={loading} className="btn-primary">
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <div className="mt-12 text-center text-sm text-muted">
          No more results. Try a different search term.
        </div>
      )}
    </div>
  );
}