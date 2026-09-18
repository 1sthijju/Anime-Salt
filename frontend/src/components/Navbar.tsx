import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { TaxonomyItem } from '../../api/types';

export function Navbar() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [genres, setGenres] = useState<TaxonomyItem[]>([]);
  const [genreOpen, setGenreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api.genres().then((g) => setGenres(g.slice(0, 14))).catch(() => {});
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (query) navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/80 backdrop-blur-xl">
      <div className="container-x flex h-16 items-center gap-3">
        <Link to="/" className="font-display text-xl font-extrabold tracking-tight">
          <span className="bg-gradient-to-r from-accent to-pink bg-clip-text text-transparent">
            AnimeSalt
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          <Link to="/" className="nav-link">Home</Link>
          <Link to="/browse/series" className="nav-link">Series</Link>
          <Link to="/browse/movies" className="nav-link">Movies</Link>
          <div
            className="relative"
            onMouseEnter={() => setGenreOpen(true)}
            onMouseLeave={() => setGenreOpen(false)}
          >
            <button className="nav-link">Genres ▾</button>
            {genreOpen && genres.length > 0 && (
              <div className="absolute left-0 top-full grid w-64 grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-2 shadow-glow">
                {genres.map((g) => (
                  <Link
                    key={g.slug}
                    to={`/genre/${g.slug}`}
                    className="rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-card hover:text-white"
                  >
                    {g.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </nav>

        <form onSubmit={submit} className="ml-auto w-full max-w-xs">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search anime…"
            className="w-full rounded-full border border-line bg-card px-4 py-2 text-sm outline-none transition focus:border-accent focus:shadow-glow"
          />
        </form>

        <button
          className="rounded-lg border border-line px-3 py-1.5 text-sm md:hidden"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menu"
        >
          ☰
        </button>
      </div>

      {menuOpen && (
        <nav className="flex flex-col gap-1 border-t border-line bg-surface px-4 py-3 md:hidden">
          <Link to="/" className="nav-link" onClick={() => setMenuOpen(false)}>Home</Link>
          <Link to="/browse/series" className="nav-link" onClick={() => setMenuOpen(false)}>Series</Link>
          <Link to="/browse/movies" className="nav-link" onClick={() => setMenuOpen(false)}>Movies</Link>
        </nav>
      )}
    </header>
  );
}