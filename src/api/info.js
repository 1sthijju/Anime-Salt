// ==========================================================================
// /api/info?id=<id> — tries /series/ then /movies/, cache-busted key
// ==========================================================================

import { fetchUpstream } from "../util/fetcher.js";
import { cached } from "../util/cache.js";
import { parseInfoPage } from "../parsers/info.js";
import { TTL } from "../config.js";
import { jsonError } from "../util/response.js";

export async function handleInfo(ctx, url) {
  const id = url.searchParams.get("id");
  if (!id) return jsonError("Missing id", 400);

  return cached(
    `info:v2:${id}`,
    TTL.info,
    async () => {
      let html, kind = "series";
      try {
        html = await fetchUpstream(`/series/${id}/`);
        if (/404 Not Found/i.test(html.slice(0, 2000))) throw new Error("not found");
      } catch {
        html = await fetchUpstream(`/movies/${id}/`);
        kind = "movie";
      }
      return parseInfoPage(html, id, kind);
    },
    ctx
  );
}