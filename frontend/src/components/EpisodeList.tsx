import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EpisodeList as EpisodeListType } from '../api/types';
import { Badge } from './ui/Badge';

export function EpisodeList({ data }: { data: EpisodeListType }) {
  const navigate = useNavigate();
  const seasons = Object.keys(data.groupedEpisodes).sort((a, b) => Number(a) - Number(b));
  const [activeSeason, setActiveSeason] = useState<string>(
    seasons[seasons.length - 1] || seasons[0] || '1'
  );

  if (!seasons.length) {
    return <div className="text-muted text-sm">No episodes available.</div>;
  }

  const episodes = data.groupedEpisodes[activeSeason] || [];

  return (
    <section>
      <h2 className="text-xl font-semibold mb-4">
        Episodes <span className="text-muted text-base">({data.totalEpisodes})</span>
      </h2>

      {seasons.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide mb-4 pb-1">
          {seasons.map((s) => (
            <Badge
              key={s}
              active={activeSeason === s}
              onClick={() => setActiveSeason(s)}
            >
              Season {s}
            </Badge>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10 gap-2">
        {episodes.map((ep) => (
          <button
            key={ep.slug}
            onClick={() => navigate(`/watch/${ep.slug}`)}
            className="px-3 py-2.5 rounded-lg bg-card border border-border hover:border-accent hover:bg-accent/10 transition text-sm text-left"
          >
            <div className="font-medium">Ep {ep.num}</div>
            <div className="text-xs text-muted line-clamp-1">
              {ep.title || `Episode ${ep.num}`}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}