import { cachedJSON, siteAjax, getSeriesHtml } from "./net.js";
import { parseEpisodesFromHtml } from "./parsers.js";

const EP_CACHE_TTL = 1800; // 30 min (seconds)

// ---------------------------------------------------------------------------
// Parse "Season 2 • 1-21 (21)" → { start: 1, end: 21, count: 21 }
// ---------------------------------------------------------------------------
function parseSeasonRange(title) {
  const t = String(title || "");
  const m = t.match(/(\d+)\s*[-–]\s*(\d+)\s*\((\d+)\)/);
  if (m) return { start: +m[1], end: +m[2], count: +m[3] };
  const c = t.match(/\((\d+)\)/);
  if (c) return { start: 1, end: +c[1], count: +c[1] };
  return null;
}

// ---------------------------------------------------------------------------
// Build a full episode list for a season without touching AJAX.
// Slug pattern:  <animeId>-<season>x<episode>
// Still pattern: https://img.animesalt.cx/image/<postId>/<season>/<episode>.webp
// ---------------------------------------------------------------------------
function synthesizeSeason(animeId, seasonNum, range, postId) {
  const eps = [];
  for (let e = range.start; e <= range.end; e++) {
    eps.push({
      num: e,
      season: seasonNum,
      title: `Episode ${e}`,
      slug: `${animeId}-${seasonNum}x${e}`,
      url: `https://animesalt.cx/episode/${animeId}-${seasonNum}x${e}/`,
      image: postId ? `https://img.animesalt.cx/image/${postId}/${seasonNum}/${e}.webp` : null,
      regionalDub: true,
      synthesized: true,
    });
  }
  return eps;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
export async function getEpisodesData(animeId, requestedSeason) {
  // getSeriesHtml may return a string OR { html, type } depending on net.js rev
  const raw = await getSeriesHtml(animeId);
  const html = typeof raw === "string" ? raw : (raw && raw.html) || "";
  if (!html) throw new Error("Empty series page");

  // ---- post id & nonce ----
  const postIdMatch =
    html.match(/postid-(\d+)/i) ||
    html.match(/data-post="(\d+)"/i) ||
    html.match(/"post_id":\s*(\d+)/i);
  const postId = postIdMatch ? postIdMatch[1] : null;

  const nonceMatch =
    html.match(/"nonce"\s*:\s*"([a-z0-9]+)"/i) ||
    html.match(/ajax_nonce\s*=\s*"([a-z0-9]+)"/i) ||
    html.match(/data-nonce="([^"]+)"/i);
  const nonce = nonceMatch ? nonceMatch[1] : "";

  // ---- season list (select → buttons → nothing) ----
  const seasons = [];
  const selectMatch = html.match(/<select[^>]*class="[^"]*sel-temp[^"]*"[^>]*>([\s\S]*?)<\/select>/i);
  if (selectMatch) {
    const optionRegex = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
    let optMatch;
    while ((optMatch = optionRegex.exec(selectMatch[1])) !== null) {
      const val = optMatch[1];
      const text = optMatch[2].replace(/<[^>]+>/g, "").trim();
      const sNumMatch = text.match(/(?:Season|S)\s*(\d+)/i) || val.match(/^(\d+)$/);
      if (sNumMatch) {
        const sNum = parseInt(sNumMatch[1], 10);
        if (sNum > 0 && !seasons.find(s => s.num === sNum)) {
          seasons.push({ num: sNum, title: text, value: val });
        }
      }
    }
  }
  if (!seasons.length) {
    const btnRegex = /<(?:button|li|a)[^>]*data-season="(\d+)"[^>]*>([\s\S]*?)<\/(?:button|li|a)>/gi;
    let btnMatch;
    while ((btnMatch = btnRegex.exec(html)) !== null) {
      const sNum = parseInt(btnMatch[1], 10);
      if (sNum > 0 && !seasons.find(s => s.num === sNum)) {
        seasons.push({ num: sNum, title: btnMatch[2].replace(/<[^>]+>/g, "").trim(), value: btnMatch[1] });
      }
    }
  }

  // No season UI at all → try a flat parse (movie-like or single-season page)
  if (!seasons.length) {
    const allEps = parseEpisodesFromHtml(html, 1);
    if (allEps.length) {
      return { postId, seasons: [], episodes: allEps, failedSeasons: [] };
    }
    return { postId, seasons: [], episodes: [], failedSeasons: [] };
  }

  const targetSeasons =
    requestedSeason === "all" || requestedSeason === undefined
      ? seasons
      : seasons.filter(s => s.num === requestedSeason);

  // ---- per season: AJAX first, deterministic synthesis as fallback ----
  const settled = await Promise.all(targetSeasons.map(async (s) => {
    let eps = [];

    // 1) WordPress AJAX grid (real titles + stills when it works)
    try {
      eps = await cachedJSON(`eps:${animeId}:s${s.num}:v3`, async () => {
        if (!postId) throw new Error("Missing postId");
        const seasonVal = s.value || String(s.num);
        const base = { action: "action_select_temp", temp: seasonVal, season: seasonVal, post: postId };
        if (nonce) base.nonce = nonce;
        let frag = await siteAjax(base);
        if (!frag.includes("/episode/")) {
          const b2 = { action: "action_select_season", temp: seasonVal, season: seasonVal, post: postId };
          if (nonce) b2.nonce = nonce;
          frag = await siteAjax(b2);
        }
        if (!frag.includes("/episode/")) throw new Error("Empty season fragment");
        return parseEpisodesFromHtml(frag, s.num);
      }, EP_CACHE_TTL);
    } catch (e) {
      eps = [];
    }

    // 2) AJAX dead/empty → synthesize from the published season range
    if (!eps || !eps.length) {
      const range = parseSeasonRange(s.title);
      if (range) eps = synthesizeSeason(animeId, s.num, range, postId);
    }

    return { num: s.num, eps: eps || [] };
  }));

  // ---- merge ----
  const episodes = [];
  const failedSeasons = [];
  for (const r of settled) {
    if (r.eps && r.eps.length) episodes.push(...r.eps);
    else failedSeasons.push(r.num);
  }

  // Absolute last resort: flat parse of the series page
  if (!episodes.length) {
    const fallback = parseEpisodesFromHtml(html, 1);
    return { postId, seasons, episodes: fallback, failedSeasons };
  }

  // dedupe + sort
  const uniqueMap = new Map();
  for (const ep of episodes) {
    if (!uniqueMap.has(ep.slug)) uniqueMap.set(ep.slug, ep);
  }
  const uniqueEpisodes = Array.from(uniqueMap.values());
  uniqueEpisodes.sort((a, b) => a.season - b.season || a.num - b.num);

  return { postId, seasons, episodes: uniqueEpisodes, failedSeasons };
}