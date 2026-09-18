import { Link } from 'react-router-dom';
import type { CardItem } from '../../api/types';

interface Props {
  item: CardItem;
  rank?: number;
}

export function AnimeCard({ item, rank }: Props) {
  return (
    <Link
      to={`/anime/${item.id}`}
      className="group relative block w-36 shrink-0 snap-start sm:w-40 md:w-44"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-line/60 bg-card transition duration-300 group-hover:border-accent/60 group-hover:shadow-glow">
        <img
          src={item.image}
          alt={item.title}
          loading="lazy"
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />

        {/* hover veil + title */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-0 transition duration-300 group-hover:opacity-100" />
        <div className="absolute inset-x-0 bottom-0 translate-y-2 p-2.5 opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <p className="line-clamp-2 text-xs font-semibold leading-snug">{item.title}</p>
        </div>

        {/* rank badge */}
        {rank != null && (
          <span
            className="absolute left-2 top-1 font-display text-2xl font-extrabold text-white/90"
            style={{ textShadow: '0 2px 10px rgba(0,0,0,.9), 0 0 20px rgba(139,92,246,.7)' }}
          >
            {rank}
          </span>
        )}

        {/* type badge */}
        <span className="absolute right-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/80 backdrop-blur-sm">
          {item.type === 'movie' ? 'Movie' : 'TV'}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-xs font-medium text-white/75 transition group-hover:text-white">
        {item.title}
      </p>
    </Link>
  );
}