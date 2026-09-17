import { Link } from 'react-router-dom';
import type { Anime } from '../api/types';

export function AnimeCard({ anime }: { anime: Anime }) {
  return (
    <Link
      to={`/anime/${anime.id}`}
      className="group block rounded-xl overflow-hidden bg-card border border-border hover:border-accent transition animate-fade-in"
    >
      <div className="relative aspect-[2/3] overflow-hidden bg-bg">
        <img
          src={anime.image}
          alt={anime.title}
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
          onError={(e) => {
            (e.target as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
        {anime.type === 'movie' && (
          <span className="absolute top-2 left-2 bg-accent text-white text-xs px-2 py-0.5 rounded">
            MOVIE
          </span>
        )}
      </div>
      <div className="p-3">
        <h3 className="text-sm font-medium line-clamp-2 leading-tight">{anime.title}</h3>
      </div>
    </Link>
  );
}

export function AnimeGrid({ items }: { items: Anime[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {items.map((a) => (
        <AnimeCard key={a.id} anime={a} />
      ))}
    </div>
  );
}