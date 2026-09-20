// ==========================================================================
// /api/info?id=<id> — series/movie detail page
// ==========================================================================

import { fetchUpstream } from "../util/fetcher.js";
import { cached } from "../util/cache.js";
import { parseInfoPage } from "../parsers/info.js";
import { TTL } from "../config.js";
import { jsonError } from "../util/response.js";

/**
 * /api/info?id=<id>
 */
export async function handleInfo(ctx, url) {
  const id = url.searchParams.get("id");
  if (!id) return jsonError("Missing id", 400);

  return cached(
    `info:${id}`,
    TTL.info,
    async () => {
      const html = await fetchUpstream(`/series/${id}/`);
      return parseInfoPage(html, id);
    },
    ctx
  );
}