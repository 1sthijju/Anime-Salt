import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { CardItem } from '../api/types';
import { PosterGrid } from '../components/ui/PosterGrid';
import { FilterBar } from '../components/ui/FilterBar';

export default function Browse() {
  const { kind, slug } = useParams<{ kind?: string; slug?: string }>();
  const navigate = useNavigate();
  const [items, setItems] = useState<CardItem[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [genre, setGenre] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);

  const title = slug
    ? `${slug.charAt(0).toUpperCase() + slug.slice(1)}`
    : kind
    ? kind.charAt(0).toUpperCase() + kind.slice(1)
    : 'Browse';

  const load = useCallback(
    async (pageNum: number, append = false) => {
      setLoading(true);
      try {
        let data: CardItem[] = [];
        if (slug) {
          // Genre route
          data = await api.genre(slug, pageNum);
        } else if (kind) {
          // Catalog route
          if (kind === 'ongoing' || kind === 'completed') {
            data = await api[kind](pageNum);
          } else {
            data = await api.browse(kind as 'series' | 'movies' | 'anime' | 'cartoon', pageNum);
          }
        }

        if (data.length < 20) setHasMore(false);
        setItems((prev) => (append ? [...prev, ...data] : data));
      } catch (e) {
        console.error('Browse load error:', e);
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [kind, slug]
  );

  useEffect(() => {
    setItems([]);
    setPage(1);
    setHasMore(true);
    load(1);
  }, [kind, slug, load]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    load(next, true);
  };

  const handleGenreChange = (g: string | null) => {
    if (g) {
      navigate(`/genre/${g}`);
    } else {
      navigate(`/browse/series`);
    }
  };

  const handleLanguageChange = (l: string | null) => {
    setLanguage(l);
    // Future: could filter client-side or add query param
  };

  return (
    <div className="container-x py-10">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-extrabold sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted">
          {slug
            ? `Browse ${slug} anime, movies, and cartoons.`
            : `Explore ${kind} content with filters and pagination.`}
        </p>
      </div>

      <FilterBar
        genre={genre}
        language={language}
        onGenreChange={handleGenreChange}
        onLanguageChange={handleLanguageChange}
      />

      <div className="mt-8">
        <PosterGrid items={items} loading={loading && items.length === 0} />
      </div>

      {hasMore && items.length > 0 && (
        <div className="mt-12 flex justify-center">
          <button onClick={loadMore} disabled={loading} className="btn-primary">
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <div className="mt-12 text-center text-sm text-muted">
          You've reached the end. Try a different filter or search.
        </div>
      )}
    </div>
  );
}