// ==========================================================================
// /api/episodes/<id>?season=<n|all> — episode lists with AJAX + synthesis fallback
// ==========================================================================

import { fetchUpstream } from "../util/fetcher.js";
import { cached } from "../util/cache.js";
import { TTL, CHROME_HEADERS, UPSTREAM } from "../config.js";
import { jsonError } from "../util/response.js";

/**
 * Fetch episodes from upstream with AJAX + synthesis fallback
 */
async function getEpisodesData(animeId, requestedSeason) {
  const html = await fetchUpstream(`/series/${animeId}/`);

  // Extract post ID and nonce for AJAX
  const postIdM = html.match(/postid-(\d+)/i) || html.match(/data-post="(\d+)"/i);
  const postId = postIdM ? postIdM[1] : null;
  const nonceM =
    html.match(/"nonce"\s*:\s*"([a-z0-9]+)"/i) ||
    html.match(/ajax_nonce\s*=\s*"([a-z0-9]+)"/i);
  const nonce = nonceM ? nonceM[1] : "";

  // Parse seasons from javascript:void(0) tabs
  const seasonTabs = [
    ...html.matchAll(
      /<a[^>]+href="javascript:void\(0\)"[^>]*>([^<]*Season\s*\d+[^<]*)<\/a>/gi
    ),
  ].map((m) => m[1].replace(/<[^>]+>/g, "").trim());

  const seasons = seasonTabs
    .map((label) => {
      const numM = label.match(/Season\s*(\d+)/i);
      const countM = label.match(/\((\d+)\)/);
      return numM
        ? {
            num: parseInt(numM[1], 10),
            title: label,
            count: countM ? parseInt(countM[1], 10) : 0,
            value: numM[1],
          }
        : null;
    })
    .filter(Boolean);

  // Filter to requested season or all
  const targets =
    requestedSeason === "all"
      ? seasons
      : seasons.filter((s) => s.num === requestedSeason);

  // Fetch each season's episodes
  const settled = await Promise.all(
    targets.map(async (s) => {
      let eps = [];

      // Try AJAX first
      try {
        if (!postId) throw new Error("no post id");
        const body = new URLSearchParams({
          action: "action_select_temp",
          temp: s.value || String(s.num),
          season: s.value || String(s.num),
          post: postId,
          ...(nonce ? { nonce } : {}),
        }).toString();

        const fragRes = await fetch(`${UPSTREAM}/wp-admin/admin-ajax.php`, {
          method: "POST",
          headers: {
            ...CHROME_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
          },
          body,
        });
        const frag = await fragRes.text();

        if (frag.includes("/episode/")) {
          const re = /<a[^>]+href="(https:\/\/animesalt\.cx\/episode\/([^"\/]+)\/?)"/gi;
          let m;
          while ((m = re.exec(frag)) !== null) {
            const sxe = m[2].match(/(\d+)x(\d+)/);
            const num = sxe ? parseInt(sxe[2], 10) : 0;
            if (num > 0) {
              eps.push({
                num,
                season: s.num,
                title: `Episode ${num}`,
                slug: m[2],
                url: m[1],
                image: null,
                regionalDub: true,
              });
            }
          }
        }
      } catch (e) {
        // AJAX failed, will try synthesis
      }

      // Synthesis fallback from published season range
      if (!eps.length) {
        const range = s.title.match(/(\d+)\s*[-–]\s*(\d+)/);
        if (range) {
          for (let e = +range[1]; e <= +range[2]; e++) {
            eps.push({
              num: e,
              season: s.num,
              title: `Episode ${e}`,
              slug: `${animeId}-${s.num}x${e}`,
              url: `https://animesalt.cx/episode/${animeId}-${s.num}x${e}/`,
              image: postId
                ? `https://img.animesalt.cx/image/${postId}/${s.num}/${e}.webp`
                : null,
              regionalDub: true,
              synthesized: true,
            });
          }
        }
      }

      return { num: s.num, eps, failed: !eps.length };
    })
  );

  // Collect episodes and failed seasons
  const episodes = [];
  const failedSeasons = [];
  for (const r of settled) {
    if (r.eps.length) episodes.push(...r.eps);
    else failedSeasons.push(r.num);
  }
  episodes.sort((a, b) => a.season - b.season || a.num - b.num);

  return { seasons, episodes, failedSeasons };
}

/**
 * /api/episodes/<id>?season=<n|all>
 */
export async function handleEpisodes(id, ctx, url) {
  if (!id) return jsonError("Missing id", 400);
  const season = url.searchParams.get("season") || "all";

  return cached(
    `eps:${id}:s${season}`,
    TTL.episodes,
    async () => {
      const r = await getEpisodesData(
        id,
        season === "all" ? "all" : Number(season)
      );

      // Group episodes by season
      const g = {};
      for (const e of r.episodes) {
        (g[String(e.season)] = g[String(e.season)] || []).push(e);
      }
      for (const s of Object.keys(g)) g[s].sort((a, b) => a.num - b.num);

      return {
        animeId: id,
        requestedSeason: season === "all" ? null : Number(season),
        availableSeasons: r.seasons.map((s) => s.num),
        totalEpisodes: r.episodes.length,
        failedSeasons: r.failedSeasons,
        groupedEpisodes: g,
      };
    },
    ctx
  );
}