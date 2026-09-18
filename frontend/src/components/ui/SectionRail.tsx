import { Link } from 'react-router-dom';
import type { CardItem, RankedItem } from '../../api/types';
import { AnimeCard } from './AnimeCard';

interface Props {
  title: string;
  items: CardItem[];
  ranked?: boolean;
  href?: string;
}

export function SectionRail({ title, items, ranked, href }: Props) {
  if (!items || items.length === 0) return null;

  return (
    <section className="mt-10 first:mt-8">
      <div className="container-x mb-3 flex items-end justify-between">
        <h2 className="font-display text-lg font-bold sm:text-xl">
          <span className="mr-2 inline-block h-4 w-1 rounded-full bg-gradient-to-b from-accent to-pink align-middle" />
          {title}
        </h2>
        {href && (
          <Link to={href} className="text-xs font-medium text-muted transition hover:text-accent-soft">
            See all →
          </Link>
        )}
      </div>

      <div className="no-scrollbar container-x flex snap-x gap-3 overflow-x-auto pb-2">
        {items.map((item, i) => (
          <AnimeCard
            key={`${item.id}-${i}`}
            item={item}
            rank={ranked ? (item as RankedItem).rank ?? i + 1 : undefined}
          />
        ))}
      </div>
    </section>
  );
}