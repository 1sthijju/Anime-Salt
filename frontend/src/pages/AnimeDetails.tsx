import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import type { AnimeInfo, EpisodeList } from '../api/types';
import { EpisodeList as EpisodeListComponent } from '../components/EpisodeList';
import { Badge } from '../components/ui/Badge';
import { Loading } from '../components/ui/Loading';
import { Error } from '../components/ui/Error';

export default function AnimeDetails() {
  const { slug } = useParams<{ slug: string }>();
  const [info, setInfo] = useState<AnimeInfo | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeList | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setErr(null);
    (async () => {
      try {
        const i = await api.info(slug);
        if (cancelled) return;
        setInfo(i);
        if (i.type === 'series' || i.seasons?.length) {
          const eps = await api.episodes(slug);
          if (!cancelled) setEpisodes(eps);
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!info && !err) return <Loading />;
  if (err) return <Error message={err} />;
  if (!info) return <Error message="Anime not found" />;

  return (
    <div className="animate-fade-in">
      {/* Back */}
      <Link to="/" className="text-sm text-muted hover:text-white mb-4 inline-block">
        ← Back
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row gap-6 mb-8">
        <div className="relative w-full md:w-48 h-72 md:h-72 flex-shrink-0 rounded-xl overflow-hidden bg-card">
          {info.poster ? (
            <img src={info.poster} alt={info.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full skeleton" />
          )}
        </div>
        <div className="flex-1">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">{info.title}</h1>
          <div className="flex flex-wrap gap-2 mb-4">
            {info.year && <Badge>{info.year}</Badge>}
            {info.status && <Badge>{info.status}</Badge>}
            <Badge>
              {info.totalEpisodes} {info.type === 'movies' ? 'Movie' : 'Episodes'}
            </Badge>
          </div>
          {info.genres.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {info.genres.map((g) => (
                <Badge key={g} variant="violet">
                  {g}
                </Badge>
              ))}
            </div>
          )}
          <p className="text-gray-300 leading-relaxed whitespace-pre-line">
            {info.description}
          </p>
          {info.languages.length > 0 && (
            <div className="mt-4 text-sm text-muted">
              <span className="font-medium text-gray-200">Audio:</span> {info.languages.join(', ')}
            </div>
          )}
        </div>
      </div>

      {/* Episodes */}
      {episodes ? (
        <EpisodeListComponent data={episodes} />
      ) : (
        info.type === 'series' && <Loading text="Loading episodes..." />
      )}
    </div>
  );
}