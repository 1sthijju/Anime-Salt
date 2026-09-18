import { useNavigate } from 'react-router-dom';
import type { RankedItem } from '../../api/types';

interface Props {
  item: RankedItem | null;
  loading?: boolean;
}

export function Hero({ item, loading }: Props) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="container-x pt-6">
        <div className="skeleton h-[380px] w-full rounded-3xl sm:h-[440px]" />
      </div>
    );
  }

  if (!item) return null;

  return (
    <div className="container-x pt-6">
      <div className="relative overflow-hidden rounded-3xl border border-line/60 shadow-glow-lg">
        {/* Cinematic backdrop built from the poster */}
        <div className="absolute inset-0" aria-hidden>
          <img
            src={item.image}
            alt=""
            className="h-full w-full scale-125 object-cover object-top opacity-40 blur-2xl"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-bg/95 via-bg/50 to-transparent" />
        </div>

        <div className="relative flex min-h-[380px] flex-col justify-end p-6 sm:min-h-[440px] sm:p-10">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-widest">
            <span className="rounded-full border border-accent/40 bg-accent/15 px-2.5 py-1 text-accent-soft">
              #1 Trending
            </span>
            <span className="rounded-full border border-line bg-card/70 px-2.5 py-1 text-muted backdrop-blur-sm">
              {item.type === 'movie' ? 'Movie' : 'Series'}
            </span>
          </div>

          <h1 className="mt-4 max-w-2xl font-display text-3xl font-extrabold leading-tight sm:text-5xl">
            {item.title}
          </h1>

          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted line-clamp-3">
            The most-watched {item.type === 'movie' ? 'film' : 'series'} on AnimeSalt right now.
            Stream it in HD with subtitles and multiple audio tracks — free, forever.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <button className="btn-primary" onClick={() => navigate(`/anime/${item.id}`)}>
              ▶ Watch Now
            </button>
            <button className="btn-ghost" onClick={() => navigate(`/anime/${item.id}`)}>
              More Info
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}