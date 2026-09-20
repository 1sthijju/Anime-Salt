// ==========================================================================
// /api/discover, /api/genres, /api/genre/<slug>, /api/language/<slug>, etc.
// ==========================================================================

import { fetchUpstream } from "../util/fetcher.js";
import { cached } from "../util/cache.js";
import { parseTaxonomy } from "../parsers/taxonomy.js";
import { parseCatalogItems } from "../parsers/cards.js";
import { TTL } from "../config.js";

/**
 * /api/discover — all taxonomy at once
 */
export async function handleDiscover(ctx) {
  return cached(
    "discover",
    TTL.taxonomy,
    async () => parseTaxonomy(await fetchUpstream("/")),
    ctx
  );
}

/**
 * /api/genres — list of all genres
 */
export async function handleGenreList(ctx) {
  return cached(
    "genres",
    TTL.taxonomy,
    async () => parseTaxonomy(await fetchUpstream("/")).genres,
    ctx
  );
}

/**
 * /api/genre/<slug>, /api/language/<slug>, etc. — paginated taxonomy results
 */
export async function handleTaxonomy(kind, slug, ctx, url) {
  const page = Number(url.searchParams.get("page") || 1);
  return cached(
    `tax:${kind}:${slug}:p${page}`,
    TTL.taxonomy,
    async () => {
      try {
        const html = await fetchUpstream(
          `/category/${kind}/${slug}/${page > 1 ? `page/${page}/` : ""}`
        );
        return {
          page,
          [kind]: slug,
          data: parseCatalogItems(html),
        };
      } catch (e) {
        return { page, [kind]: slug, data: [], error: e.message };
      }
    },
    ctx
  );
}

/**
 * List of supported taxonomy kinds
 */
export const TAXONOMY_KINDS = [
  "genre",
  "language",
  "country",
  "type",
  "year",
  "network",
  "franchise",
  "status",
];