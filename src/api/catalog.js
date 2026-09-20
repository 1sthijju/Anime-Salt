// ==========================================================================
// /api/series, /api/movies, /api/anime, /api/cartoon, /api/ongoing,
// /api/completed, /api/fresh-drops, /api/popular, /api/random,
// /api/letter/<A-Z|#>
// ==========================================================================

import { fetchUpstream } from "../util/fetcher.js";
import { cached } from "../util/cache.js";
import { parseCatalogItems, parseMostWatched } from "../parsers/cards.js";
import { TTL } from "../config.js";
import { jsonError } from "../util/response.js";

/**
 * Map API paths to upstream paths
 */
const CATALOG_PATHS = {
  series: "/series/",
  movies: "/movies/",
  anime: "/category/anime/",
  cartoon: "/category/cartoon/",
  ongoing: "/category/status/ongoing/",
  completed: "/category/status/completed/",
  "fresh-drops": "/",
  popular: "/",
  "popular/series": "/",
  "popular/films": "/",
};

/**
 * Generic catalog handler with pagination
 */
export async function handleCatalog(kind, ctx, url) {
  const page = Number(url.searchParams.get("page") || 1);
  const upstreamPath = CATALOG_PATHS[kind] || `/${kind}/`;

  return cached(
    `cat:${kind}:p${page}`,
    TTL.catalog,
    async () => {
      try {
        const html = await fetchUpstream(
          upstreamPath + (page > 1 ? `page/${page}/` : "")
        );
        let items = parseCatalogItems(html);

        if (kind === "popular/series") {
          items = items.filter((i) => i.type === "series").map((it, i) => ({ rank: i + 1, ...it }));
        } else if (kind === "popular/films") {
          items = items.filter((i) => i.type === "movie").map((it, i) => ({ rank: i + 1, ...it }));
        } else if (kind === "popular") {
          items = items.map((it, i) => ({ rank: i + 1, ...it }));
        }

        return { page, data: items };
      } catch (e) {
        return { page, data: [], error: e.message };
      }
    },
    ctx
  );
}

/**
 * /api/random — random title from homepage catalog
 */
export async function handleRandom(ctx) {
  return cached(
    "random",
    TTL.random,
    async () => {
      const html = await fetchUpstream("/");
      const items = parseCatalogItems(html);
      return items.length
        ? items[Math.floor(Math.random() * items.length)]
        : null;
    },
    ctx
  );
}

/**
 * /api/letter/<A-Z|#> — titles starting with given letter.
 * Returns a raw JSON array (consistent with /api/home/<section>).
 * Upstream URL pattern: /letter/<lower>/ or fallback to search query.
 */
export async function handleLetter(letter, ctx) {
  const norm = String(letter).toUpperCase();
  if (!/^[#A-Z]$/.test(norm)) return jsonError("Invalid letter", 400);

  return cached(
    `letter:${norm}`,
    TTL.catalog,
    async () => {
      // Most WP anime themes use /letter/<l>/; fall back to search if 404
      const slug = norm === "#" ? "a" : norm.toLowerCase();
      const candidates = [
        `/letter/${slug}/`,
        `/browse/${slug}/`,
        `/?s=${encodeURIComponent(norm === "#" ? "#" : norm)}&letter=${slug}`,
      ];

      for (const path of candidates) {
        try {
          const html = await fetchUpstream(path);
          if (/404 Not Found/i.test(html.slice(0, 500))) continue;
          const items = parseCatalogItems(html);
          if (items.length) return items;
        } catch {
          continue;
        }
      }
      return [];
    },
    ctx
  );
}