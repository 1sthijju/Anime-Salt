// ==========================================================================
// /api/info?id=<id> — series→movies fallback + status inference
// ==========================================================================

import { fetchUpstream } from "../util/fetcher.js";
import { cached } from "../util/cache.js";
import { parseInfoPage } from "../parsers/info.js";
import { TTL } from "../config.js";
import { jsonError } from "../util/response.js";

async function inferStatus(id) {
  const needles = [`/series/${id}/`, `/movies/${id}/`];
  try {
    for (let p = 1; p <= 2; p++) {
      const ong = await fetchUpstream(`/category/status/ongoing/${p > 1 ? `page/${p}/` : ""}`);
      if (needles.some((n) => ong.includes(n))) return "Ongoing";
    }
    for (let p = 1; p <= 2; p++) {
      const comp = await fetchUpstream(`/category/status/completed/${p > 1 ? `page/${p}/` : ""}`);
      if (needles.some((n) => comp.includes(n))) return "Completed";
    }
  } catch {}
  return "";
}

export async function handleInfo(ctx, url) {
  const id = url.searchParams.get("id");
  if (!id) return jsonError("Missing id", 400);

  return cached(
    `info:v3:${id}`,
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