// ==========================================================================
// /api/search?keyword=<kw>&page=<n>
// ==========================================================================

import { fetchUpstream } from "../util/fetcher.js";
import { cached } from "../util/cache.js";
import { parseCatalogItems } from "../parsers/cards.js";
import { TTL } from "../config.js";
import { jsonError } from "../util/response.js";

/**
 * /api/search?keyword=<kw>&page=<n>
 */
export async function handleSearch(ctx, url) {
  const keyword = url.searchParams.get("keyword");
  const page = Number(url.searchParams.get("page") || 1);
  if (!keyword) return jsonError("Missing keyword", 400);

  return cached(
    `search:${keyword.toLowerCase()}:p${page}`,
    TTL.catalog,
    async () => {
      const html = await fetchUpstream(
        `/?s=${encodeURIComponent(keyword)}${page > 1 ? `&paged=${page}` : ""}`
      );
      return {
        page,
        keyword,
        data: parseCatalogItems(html),
      };
    },
    ctx
  );
}