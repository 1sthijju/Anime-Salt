// ==========================================================================
// /api/info?id=<id>&debug=1 — series/movie detail with debug output
// v5: cache key bumped (info:v5) to purge stale wrong-poster entries
// ==========================================================================

import { fetchUpstream } from "../util/fetcher.js";
import { cached } from "../util/cache.js";
import { parseInfoPage } from "../parsers/info.js";
import { TTL } from "../config.js";
import { jsonError } from "../util/response.js";

/**
 * Infer status by checking status category pages (best effort, pages 1-2)
 */
async function inferStatus(id) {
  const needles = [`/series/${id}/`, `/movies/${id}/`];
  try {
    for (let p = 1; p <= 2; p++) {
      const ong = await fetchUpstream(
        `/category/status/ongoing/${p > 1 ? `page/${p}/` : ""}`
      );
      if (needles.some((n) => ong.includes(n))) return "Ongoing";
    }
    for (let p = 1; p <= 2; p++) {
      const comp = await fetchUpstream(
        `/category/status/completed/${p > 1 ? `page/${p}/` : ""}`
      );
      if (needles.some((n) => comp.includes(n))) return "Completed";
    }
  } catch {
    // Status inference failed — leave empty
  }
  return "";
}

/**
 * /api/info?id=<id>
 * Optional: &debug=1 returns raw HTML for inspection
 */
export async function handleInfo(ctx, url) {
  const id = url.searchParams.get("id");
  const debug = url.searchParams.get("debug") === "1";
  if (!id) return jsonError("Missing id", 400);

  // Debug mode: return raw HTML for parser debugging
  if (debug) {
    try {
      let html;
      try {
        html = await fetchUpstream(`/series/${id}/`);
        if (/404 Not Found/i.test(html.slice(0, 2000))) throw new Error("not found");
      } catch {
        html = await fetchUpstream(`/movies/${id}/`);
      }
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (e) {
      return jsonError(e.message, 500);
    }
  }

  // Normal mode: parse and cache (key bumped to v5 to purge stale posters)
  return cached(
    `info:v5:${id}`,
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
      const info = parseInfoPage(html, id, kind);
      if (!info.status) info.status = await inferStatus(id);
      return info;
    },
    ctx
  );
}