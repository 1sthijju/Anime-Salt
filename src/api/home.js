// ==========================================================================
// /api/home/* — modular home endpoints
// ==========================================================================

import { fetchUpstream } from "../util/fetcher.js";
import { cached } from "../util/cache.js";
import {
  parseFeatured,
  parseLatest,
  parseMostWatched,
  parseCatalogItems,
} from "../parsers/cards.js";
import { TTL } from "../config.js";
import { jsonError } from "../util/response.js";

/**
 * /api/home/hero — featured items + ticker
 */
export async function handleHomeHero(ctx) {
  return cached(
    "home:hero",
    TTL.hero,
    async () => {
      const html = await fetchUpstream("/");
      return {
        featured: parseFeatured(html).slice(0, 6),
        tickerItems: parseLatest(html)
          .slice(0, 14)
          .map((it) => ({ title: it.title, sub: "new drop" })),
      };
    },
    ctx
  );
}

/**
 * Section fetchers — each maps to a modular /api/home/<section> endpoint
 */
const SECTION_FETCHERS = {
  latest: () => fetchUpstream("/").then(parseLatest),
  "most-watched-series": () =>
    fetchUpstream("/").then((h) => parseMostWatched(h).series),
  "most-watched-films": () =>
    fetchUpstream("/").then((h) => parseMostWatched(h).films),
  "fresh-drops": () =>
    fetchUpstream("/").then(parseCatalogItems).then((d) => d.slice(0, 12)),
  ongoing: () =>
    fetchUpstream("/category/status/ongoing/").then(parseCatalogItems),
  completed: () =>
    fetchUpstream("/category/status/completed/").then(parseCatalogItems),
  movies: () => fetchUpstream("/movies/").then(parseCatalogItems),
};

/**
 * /api/home/<section> — generic section handler
 */
export async function handleHomeSection(section, ctx) {
  const fetcher = SECTION_FETCHERS[section];
  if (!fetcher) return jsonError(`Unknown section: ${section}`, 404);
  return cached(
    `home:section:${section}`,
    TTL.section,
    async () => {
      try {
        return await fetcher();
      } catch (e) {
        console.error(`Section ${section} failed:`, e.message);
        return [];
      }
    },
    ctx
  );
}

/**
 * List of available sections (for /api/home root)
 */
export const HOME_SECTIONS = Object.keys(SECTION_FETCHERS);