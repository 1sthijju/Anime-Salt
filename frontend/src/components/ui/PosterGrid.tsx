import type { CardItem } from '../../api/types';
import { AnimeCard } from '../AnimeCard';

interface Props {
  items: CardItem[];
  loading?: boolean;
  empty?: string;
}

export function PosterGrid({ items, loading, empty }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 18 }).map((_, i) => (
          <div key={i}>
            <div className="skeleton aspect-[2/3]" />
            <div className="skeleton mt-2 h-3 w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="py-24 text-center text-muted">
        {empty || 'No results found.'}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {items.map((item, i) => (
        <AnimeCard key={`${item.id}-${i}`} item={item} />
      ))}
    </div>
  );
}