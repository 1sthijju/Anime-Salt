import { Link } from 'react-router-dom';
import { useContinueWatching } from '../../hooks/useContinueWatching';

function prettySlug(slug: string) {
  const base = slug.replace(/-\d+x\d+$/, '').replace(/-/g, ' ');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function epLabel(slug: string) {
  const m = slug.match(/-(\d+)x(\d+)$/);
  return m ? `S${m[1]} E${m[2]}` : null;
}

export function ContinueWatching() {
  const { entries, remove, clearAll } = useContinueWatching();
  if (!entries.length) return null;

  return (
    <section className="container-x mt-8">
      <div className="mb-3 flex items-end justify-between">
        <h2 className="font-display text-lg font-bold sm:text-xl">
          <span className="mr-2 inline-block h-4 w-1 rounded-full bg-gradient-to-b from-accent to-pink align-middle" />
          Continue Watching
        </h2>
        <button onClick={clearAll} className="text-xs font-medium text-muted transition hover:text-red-400">
          Clear all
        </button>
      </div>

      <div className="no-scrollbar flex snap-x gap-3 overflow-x-auto pb-2">
        {entries.map((e) => {
          const pct = Math.min(100, Math.round((e.time / e.duration) * 100));
          const label = epLabel(e.slug);
          return (
            <div key={e.slug} className="group relative w-64 shrink-0 snap-start">
              <Link to={`/watch/${e.slug}`} className="block">
                <div className="relative aspect-video overflow-hidden rounded-xl border border-line/60 bg-gradient-to-br from-card to-surface transition group-hover:border-accent/60 group-hover:shadow-glow">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/20 text-lg text-accent-soft backdrop-blur-sm transition group-hover:scale-110 group-hover:bg-accent/40">
                      ▶
                    </span>
                  </div>
                  {label && (
                    <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/80 backdrop-blur-sm">
                      {label}
                    </span>
                  )}
                  {/* progress bar */}
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
                    <div className="h-full bg-gradient-to-r from-accent to-pink" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white/80">
                    {pct}%
                  </span>
                </div>
                <p className="mt-2 line-clamp-1 text-xs font-medium text-white/75 transition group-hover:text-white">
                  {e.title || prettySlug(e.slug)}
                </p>
              </Link>
              <button
                onClick={() => remove(e.slug)}
                title="Remove from list"
                className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-white/60 opacity-0 backdrop-blur-sm transition hover:bg-red-500/80 hover:text-white group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}