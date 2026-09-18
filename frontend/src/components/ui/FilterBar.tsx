import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { TaxonomyItem } from '../../api/types';

interface Props {
  genre?: string;
  language?: string;
  onGenreChange: (slug: string | null) => void;
  onLanguageChange: (slug: string | null) => void;
}

export function FilterBar({ genre, language, onGenreChange, onLanguageChange }: Props) {
  const [genres, setGenres] = useState<TaxonomyItem[]>([]);
  const [languages, setLanguages] = useState<TaxonomyItem[]>([]);

  useEffect(() => {
    api.genres().then((g) => setGenres(g.slice(0, 12))).catch(() => {});
    api.languages().then((l) => setLanguages(l.slice(0, 8))).catch(() => {});
  }, []);

  return (
    <div className="space-y-3">
      {genres.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onGenreChange(null)}
            className={`chip ${!genre ? 'chip-active' : ''}`}
          >
            All Genres
          </button>
          {genres.map((g) => (
            <button
              key={g.slug}
              onClick={() => onGenreChange(g.slug === genre ? null : g.slug)}
              className={`chip ${g.slug === genre ? 'chip-active' : ''}`}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      {languages.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onLanguageChange(null)}
            className={`chip ${!language ? 'chip-active' : ''}`}
          >
            All Languages
          </button>
          {languages.map((l) => (
            <button
              key={l.slug}
              onClick={() => onLanguageChange(l.slug === language ? null : l.slug)}
              className={`chip ${l.slug === language ? 'chip-active' : ''}`}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}