import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="mt-16 border-t border-line/60 bg-surface/50">
      <div className="container-x flex flex-col items-center gap-4 py-8 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <p className="font-display font-bold">
            <span className="bg-gradient-to-r from-accent to-pink bg-clip-text text-transparent">
              AnimeSalt
            </span>
          </p>
          <p className="mt-1 max-w-md text-xs text-muted">
            Not affiliated with any content provider. All media is streamed from
            third-party hosts. For private use only.
          </p>
        </div>
        <nav className="flex gap-4 text-xs text-muted">
          <Link to="/browse/series" className="hover:text-white">Series</Link>
          <Link to="/browse/movies" className="hover:text-white">Movies</Link>
          <Link to="/browse/cartoon" className="hover:text-white">Cartoons</Link>
        </nav>
      </div>
    </footer>
  );
}