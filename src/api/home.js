// ==========================================================================
// /api/home/* — every section from ONE cached homepage fetch
// v3: section-scoped parsing + legacy category fallbacks + debug report
// ==========================================================================

import { fetchUpstream } from "../util/fetcher.js";
import { cached } from "../util/cache.js";
import {
  parseHomeSections,
  parseNetworkStrip,
  parseAzIndex,
  inspectHomeSections,
} from "../parsers/home.js";
import { parseCatalogItems } from "../parsers/cards.js";
import { TTL } from "../config.js";
import { jsonError } from "../util/response.js";

export const HOME_SECTIONS = [
  "latest",
  "most-watched-series",
  "most-watched-films",
  "fresh-drops",
  "on-air",
  "new-arrivals",
  "cartoon-series",
  "anime-movies",
  "cartoon-films",
  "networks",
  "az",
  // legacy keys served from dedicated category pages:
  "ongoing",
  "completed",
  "movies",
];

const LEGACY = {
  ongoing: "/category/status/ongoing/",
  completed: "/category/status/completed/",
  movies: "/movies/",
};

/** One cached parse of the homepage → full section map */
async function sectionsMap(ctx) {
  const res = await cached("home:sections:v2", TTL.section, async () => {
    const html = await fetchUpstream("/");
    return {
      ...parseHomeSections(html),
      networks: parseNetworkStrip(html),
      az: parseAzIndex(html),
    };
  }, ctx);
  return await res.json();
}

/**
 * /api/home/hero — featured (top-3 series + top-3 films) + ticker
 */
export async function handleHomeHero(ctx) {
  return cached("home:hero:v2", TTL.hero, async () => {
    const map = await sectionsMap(ctx);
    return {
      featured: [
        ...(map["most-watched-series"] || []).slice(0, 3),
        ...(map["most-watched-films"] || []).slice(0, 3),
      ],
      tickerItems: (map["new-arrivals"] || map["latest"] || [])
        .slice(0, 14)
        .map((it) => ({ title: it.title, sub: "new drop" })),
    };
  }, ctx);
}

/**
 * /api/home/<section> — raw JSON array per section
 */
export async function handleHomeSection(section, ctx) {
  // Legacy keys keep their dedicated category pages
  if (LEGACY[section]) {
    return cached(
      `home:section:${section}`,
      TTL.section,
      async () => parseCatalogItems(await fetchUpstream(LEGACY[section])),
      ctx
    );
  }

  const map = await sectionsMap(ctx);
  const data = map[section];
  if (!data) return jsonError(`Unknown section: ${section}`, 404);

  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": `public, max-age=${TTL.section}, stale-while-revalidate=86400`,
    },
  });
}

/**
 * /api/debug/home — per-section parse report against the LIVE homepage
 */
export async function handleHomeDebug(ctx) {
  return cached("home:debug:v1", 60, async () => {
    const html = await fetchUpstream("/");
    return { htmlLength: html.length, sections: inspectHomeSections(html) };
  }, ctx);
}