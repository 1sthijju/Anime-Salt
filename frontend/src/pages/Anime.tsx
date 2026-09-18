import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { AnimeInfo, Episode } from '../api/types';

export default function Anime() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [info, setInfo] = useState<AnimeInfo | null>(null);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [groupedEpisodes, setGroupedEpisodes] = useState<Record<string, Episode[]>>({});
  const [activeSeason, setActiveSeason] = useState<number | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [infoData, epData] = await Promise.all([
        api.info(id),
        api.episodes(id, 'all' as any),
      ]);
      setInfo(infoData);
      setSeasons(epData.availableSeasons);
      setGroupedEpisodes(epData.groupedEpisodes);
      // Auto-select season 1 if multiple seasons exist
      if (epData.availableSeasons.length > 1) {
        setActiveSeason(epData.availableSeasons[0]);
      } else {
        setActiveSeason('all');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSeasonChange = async (season: number | 'all') => {
    setActiveSeason(season);
    if (!id) return;
    try {
      const epData = await api.episodes(id, season as any);
      setGroupedEpisodes(epData.groupedEpisodes);
    } catch (e) {
      console.error('Episode reload error:', e);
    }
  };

  // Flatten episodes for active season
  const episodes: Episode[] = (() => {
    if (activeSeason === 'all') {
      return Object.values(groupedEpisodes).flat().sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season;
        return a.num - b.num;
      });
    }
    return groupedEpisodes[String(activeSeason)] || [];
  })();

  if (loading) {
    return (
      <div className="container-x py-10">
        <div className="flex flex-col gap-8 md:flex-row">
          <div className="skeleton aspect-[2/3] w-full max-w-xs" />
          <div className="flex-1 space-y-4">
            <div className="skeleton h-10 w-3/4" />
            <div className="skeleton h-4 w-1/2" />
            <div className="skeleton h-24 w-full" />
            <div className="flex gap-2">
              <div className="skeleton h-6 w-20" />
              <div className="skeleton h-6 w-20" />
              <div className="skeleton h-6 w-20" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="container-x py-32 text-center">
        <h1 className="font-display text-2xl font-bold text-red-400">Not Found</h1>
        <p className="mt-2 text-sm text-muted">
          {error || "This anime doesn't exist or couldn't be loaded."}
        </p>
        <button className="btn-ghost mt-6" onClick={() => navigate(-1)}>
          ← Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="pb-16">
      {/* Cinematic Hero */}
      <div className="relative">
        <div className="absolute inset-0 -z-10" aria-hidden>
          <img
            src={info.poster}
            alt=""
            className="h-full w-full scale-125 object-cover object-top opacity-30 blur-3xl"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/80 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/60 to-transparent" />
        </div>

        <div className="container-x flex flex-col gap-8 pt-8 md:flex-row md:pt-12">
          {/* Poster */}
          <div className="shrink-0">
            <div className="relative aspect-[2/3] w-full max-w-[260px] overflow-hidden rounded-2xl border border-line/60 shadow-glow-lg mx-auto md:mx-0">
              <img
                src={info.poster}
                alt={info.title}
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 space-y-4">
            {/* Type + Year badges */}
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-widest">
              <span className="rounded-full border border-accent/40 bg-accent/15 px-2.5 py-1 text-accent-soft">
                {info.type === 'movies' ? 'Movie' : 'Series'}
              </span>
              {info.year && (
                <span className="rounded-full border border-line bg-card/70 px-2.5 py-1 text-muted backdrop-blur-sm">
                  {info.year}
                </span>
              )}
              <span className="rounded-full border border-line bg-card/70 px-2.5 py-1 text-muted backdrop-blur-sm">
                {info.status}
              </span>
              <span className="rounded-full border border-line bg-card/70 px-2.5 py-1 text-muted backdrop-blur-sm">
                {info.totalEpisodes} {info.type === 'movies' ? 'min' : 'eps'}
              </span>
            </div>

            {/* Title */}
            <h1 className="font-display text-3xl font-extrabold leading-tight sm:text-5xl">
              {info.title}
            </h1>

            {/* Genres */}
            {info.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {info.genres.map((g) => (
                  <span key={g} className="chip">
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Description */}
            {info.description && (
              <p className="max-w-2xl text-sm leading-relaxed text-muted line-clamp-5 md:line-clamp-none">
                {info.description}
              </p>
            )}

            {/* Languages */}
            {info.languages.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-semibold uppercase tracking-wider">Languages:</span>
                {info.languages.map((l) => (
                  <span key={l} className="text-white/70">{l}</span>
                ))}
              </div>
            )}

            {/* Watch CTA (only if episodes exist) */}
            {episodes.length > 0 && (
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  className="btn-primary"
                  onClick={() => navigate(`/watch/${episodes[0].slug}`)}
                >
                  ▶ Watch Episode 1
                </button>
                <Link
                  to={`#episodes`}
                  className="btn-ghost"
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById('episodes')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  Browse Episodes
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Episodes Section */}
      <div id="episodes" className="container-x mt-12 scroll-mt-20">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 className="font-display text-xl font-bold sm:text-2xl">
            <span className="mr-2 inline-block h-5 w-1 rounded-full bg-gradient-to-b from-accent to-pink align-middle" />
            Episodes
          </h2>
          {info.totalEpisodes > 0 && (
            <span className="text-sm text-muted">{info.totalEpisodes} total</span>
          )}
        </div>

        {/* Season tabs */}
        {seasons.length > 1 && (
          <div className="no-scrollbar mb-6 flex gap-2 overflow-x-auto pb-2">
            <button
              onClick={() => handleSeasonChange('all')}
              className={`chip shrink-0 ${activeSeason === 'all' ? 'chip-active' : ''}`}
            >
              All Seasons
            </button>
            {seasons.map((s) => (
              <button
                key={s}
                onClick={() => handleSeasonChange(s)}
                className={`chip shrink-0 ${activeSeason === s ? 'chip-active' : ''}`}
              >
                Season {s}
              </button>
            ))}
          </div>
        )}

        {/* Episode grid */}
        {episodes.length === 0 ? (
          <div className="py-16 text-center text-muted">
            No episodes available yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {episodes.map((ep) => (
              <Link
                key={ep.slug}
                to={`/watch/${ep.slug}`}
                className="group relative overflow-hidden rounded-xl border border-line/60 bg-card p-4 transition duration-200 hover:border-accent/60 hover:shadow-glow"
              >
                <div className="absolute right-3 top-3 font-display text-3xl font-extrabold text-white/20 transition group-hover:text-accent/40">
                  {ep.num}
                </div>
                <div className="relative z-10 pr-10">
                  <p className="text-xs text-muted">
                    {seasons.length > 1 && activeSeason === 'all'
                      ? `S${ep.season}E${ep.num}`
                      : `Episode ${ep.num}`}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-white/90 group-hover:text-white">
                    {ep.title}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}