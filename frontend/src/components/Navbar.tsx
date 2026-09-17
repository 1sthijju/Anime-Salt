import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';

export function Navbar() {
  const navigate = useNavigate();
  const { addToSearchHistory } = useAppContext();
  const [q, setQ] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) return;
    addToSearchHistory(trimmed);
    navigate(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <header className="sticky top-0 z-40 backdrop-blur bg-bg/80 border-b border-border">
      <nav className="max-w-7xl mx-auto px-4 h-16 flex items-center gap-6">
        <Link
          to="/"
          className="font-bold text-xl bg-gradient-to-r from-accent to-accent2 bg-clip-text text-transparent shrink-0"
        >
          AnimeSalt
        </Link>
        <Link to="/" className="text-sm text-gray-300 hover:text-white hidden sm:block">
          Home
        </Link>
        <form onSubmit={handleSubmit} className="ml-auto flex-1 max-w-md">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search anime..."
            className="w-full px-4 py-2 bg-card border border-border rounded-full text-sm focus:outline-none focus:border-accent transition"
          />
        </form>
      </nav>
    </header>
  );
}