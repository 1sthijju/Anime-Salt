// ==========================================================================
// /api/episodes/<id>?season=<n|all>
//
// v3 fixes:
//  - Tries /series/<id>/ THEN /movies/<id>/ (movies previously 404 → 500)
//  - Movies return ONE synthetic episode (slug = id) so watch flow is uniform
//  - Series: per-season AJAX → page-preview slugs → range synthesis fallback
//  - NEVER returns 500: total failure → empty 200 payload
// ==========================================================================

import { fetchUpstream } from "../util/fetcher.js";
import { cached } from "../util/cache.js";
import { parseInfoPage } from "../parsers/info.js";
import { TTL } from "../config.js";

/**
 * Fetch the title page regardless of type.
 * Movies live at /movies/<id>/, series at /series/<id>/.
 */
async function fetchTitlePage(id) {
  const candidates = [`/series/${id}/`, `/movies/${id}/`];
  let lastErr;
  for (const path of candidates) {
    try {
      return await fetchUpstream(path);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Title page not found");
}

/**
 * Try upstream episode AJAX for one season.
 * Returns normalized list or null on any failure (never throws).
 */
async function fetchSeasonAjax(id, season) {
  const urls = [
    `/ajax/episode/list?slug=${encodeURIComponent(id)}&season=${season}`,
    `/ajax/episodes/${encodeURIComponent(id)}?season=${season}`,
  ];
  for (const u of urls) {
    try {
      const raw = await fetchUpstream(u, { timeoutMs: 8000, retries: 1 });
      const j = JSON.parse(raw);
      const list = Array.isArray(j) ? j : (j.episodes || j.data || []);
      if (Array.isArray(list) && list.length) {
        return list.map((e, i) => ({
          num: Number(e.num ?? e.episode ?? e.number ?? i + 1),
          season: Number(e.season ?? season),
          title: e.title || e.name || `Episode ${e.num ?? i + 1}`,
          slug: e.slug || e.id || `${id}-${season}x${e.num ?? i + 1}`,
          url: e.url || `https://animesalt.cx/episode/${e.slug || e.id || ""}/`,
          image: e.image || e.thumbnail || null,
        }));
      }
    } catch {
      // try next URL
    }
  }
  return null;
}

/**
 * Synthesize episodes from a published range (e.g. "Season 1 • 1-25 (25)").
 */
function synthesize(id, season, count) {
  const out = [];
  const n = Number(count) || 0;
  for (let e = 1; e <= n; e++) {
    out.push({
      num: e,
      season,
      title: `Episode ${e}`,
      slug: `${id}-${season}x${e}`,
      url: `https://animesalt.cx/episode/${id}-${season}x${e}/`,
      image: null,
      synthesized: true,
    });
  }
  return out;
}

/**
 * Main handler.
 * Response shape (always 200):
 * {
 *   animeId, type, availableSeasons[], totalEpisodes,
 *   groupedEpisodes: { "1": [Episode], "2": [...] },
 *   failedSeasons: []
 * }
 */
export async function handleEpisodes(id, ctx, url) {
  const seasonParam = (url.searchParams.get("season") || "all").toLowerCase();

  return cached(
    `eps:v3:${id}:${seasonParam}`,
    TTL.episodes,
    async () => {
      // ---- page fetch failed → graceful empty (never 500) ----
      let html;
      try {
        html = await fetchTitlePage(id);
      } catch {
        return {
          animeId: id,
          type: "unknown",
          availableSeasons: [],
          totalEpisodes: 0,
          groupedEpisodes: {},
          failedSeasons: [],
        };
      }

      // ---- parse info (seasons, type, episode previews) ----
      let info = {};
      try { info = parseInfoPage(html, id) || {}; } catch {}

      // ---- MOVIE (or no seasons): single synthetic episode ----
      if (info.type === "movie" || !(info.seasons && info.seasons.length)) {
        const single = {
          num: 1,
          season: 1,
          title: info.title || id,
          slug: id,                       // stream endpoint accepts movie id directly
          url: `https://animesalt.cx/movies/${id}/`,
          image: info.poster || null,
          movie: true,
        };
        return {
          animeId: id,
          type: info.type || "movie",
          availableSeasons: [1],
          totalEpisodes: 1,
          groupedEpisodes: { "1": [single] },
          failedSeasons: [],
        };
      }

      // ---- SERIES ----
      const allSeasons = info.seasons.map((s) => s.num);
      const wantedNum = Number(seasonParam);
      const wanted =
        seasonParam === "all" || !Number.isFinite(wantedNum)
          ? allSeasons
          : allSeasons.includes(wantedNum) ? [wantedNum] : [wantedNum];

      const previews = Array.isArray(info.episodesPreview) ? info.episodesPreview : [];
      const grouped = {};
      const failed = [];
      let total = 0;

      for (const s of wanted) {
        const meta = info.seasons.find((x) => x.num === s) || { count: 0 };

        // 1) upstream AJAX
        let list = await fetchSeasonAjax(id, s);

        // 2) real slugs from the info page previews (this season only)
        if (!list || !list.length) {
          const prev = previews.filter((e) => Number(e.season) === s);
          if (prev.length) {
            list = prev.map((e) => ({
              num: e.num,
              season: s,
              title: e.title || `Episode ${e.num}`,
              slug: e.slug,
              url: `https://animesalt.cx/episode/${e.slug}/`,
              image: e.image || null,
            }));
          }
        }

        // 3) synthesize from published range
        if (!list || !list.length) list = synthesize(id, s, meta.count);

        if (!list || !list.length) { failed.push(s); continue; }

        list.sort((a, b) => a.num - b.num);
        grouped[String(s)] = list;
        total += list.length;
      }

      return {
        animeId: id,
        type: "series",
        availableSeasons: wanted,
        totalEpisodes: total,
        groupedEpisodes: grouped,
        failedSeasons: failed,
      };
    },
    ctx
  );
}