import { cachedJSON, siteAjax, getSeriesHtml } from "./net.js";
import { parseEpisodesFromHtml } from "./parsers.js";

export async function getEpisodesData(animeId, requestedSeason) {
  const html = await getSeriesHtml(animeId);

  const postIdMatch = html.match(/postid-(\d+)/i) || html.match(/data-post="(\d+)"/i) || html.match(/"post_id":\s*(\d+)/i);
  const postId = postIdMatch ? postIdMatch[1] : null;
  const nonceMatch = html.match(/"nonce"\s*:\s*"([a-z0-9]+)"/i) || html.match(/ajax_nonce\s*=\s*"([a-z0-9]+)"/i);
  const nonce = nonceMatch ? nonceMatch[1] : "";

  const seasons = [];
  const selectMatch = html.match(/<select[^>]*class="[^"]*sel-temp[^"]*"[^>]*>([\s\S]*?)<\/select>/i);
  if (selectMatch) {
    const optionRegex = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
    let optMatch;
    while ((optMatch = optionRegex.exec(selectMatch[1])) !== null) {
      const val = optMatch[1];
      const text = optMatch[2].replace(/<[^>]+>/g, '').trim();
      const sNumMatch = text.match(/(?:Season|S)\s*(\d+)/i) || val.match(/^(\d+)$/);
      if (sNumMatch) {
        const sNum = parseInt(sNumMatch[1], 10);
        if (sNum > 0 && !seasons.find(s => s.num === sNum)) seasons.push({ num: sNum, title: text, value: val });
      }
    }
  }
  if (seasons.length === 0) {
    const btnRegex = /<(?:button|li|a)[^>]*data-season="(\d+)"[^>]*>([\s\S]*?)<\/(?:button|li|a)>/gi;
    let btnMatch;
    while ((btnMatch = btnRegex.exec(html)) !== null) {
      const sNum = parseInt(btnMatch[1], 10);
      if (sNum > 0 && !seasons.find(s => s.num === sNum)) seasons.push({ num: sNum, title: btnMatch[2].replace(/<[^>]+>/g, '').trim(), value: btnMatch[1] });
    }
  }

  if (seasons.length === 0) {
    const allEps = parseEpisodesFromHtml(html, 1);
    allEps.sort((a, b) => a.season - b.season || a.num - b.num);
    return { postId: null, seasons: [], episodes: allEps, failedSeasons: [] };
  }

  const targetSeasons = requestedSeason === "all" || requestedSeason === undefined
    ? seasons
    : seasons.filter(s => s.num === requestedSeason);

  const settled = await Promise.all(targetSeasons.map(async (s) => {
    try {
      const eps = await cachedJSON(`eps:${animeId}:s${s.num}`, async () => {
        if (!postId) throw new Error("Missing postId");
        const seasonVal = s.value || s.num;
        const base = { action: "action_select_temp", temp: String(seasonVal), season: String(seasonVal), post: String(postId) };
        if (nonce) base.nonce = nonce;
        let frag = await siteAjax(base);
        if (!frag.includes("/episode/")) {
          const base2 = { action: "action_select_season", temp: String(seasonVal), season: String(seasonVal), post: String(postId) };
          if (nonce) base2.nonce = nonce;
          frag = await siteAjax(base2);
        }
        if (!frag.includes("/episode/")) throw new Error("Empty season fragment");
        return parseEpisodesFromHtml(frag, s.num);
      });
      return { num: s.num, eps };
    } catch (e) {
      return { num: s.num, eps: null };
    }
  }));

  const episodes = [];
  const failedSeasons = [];
  for (const r of settled) {
    if (r.eps) episodes.push(...r.eps);
    else failedSeasons.push(r.num);
  }

  if (episodes.length === 0) {
    const fallback = parseEpisodesFromHtml(html, 1);
    return { postId, seasons, episodes: fallback, failedSeasons };
  }

  const uniqueMap = new Map();
  for (const ep of episodes) { if (!uniqueMap.has(ep.slug)) uniqueMap.set(ep.slug, ep); }
  const uniqueEpisodes = Array.from(uniqueMap.values());
  uniqueEpisodes.sort((a, b) => a.season - b.season || a.num - b.num);

  return { postId, seasons, episodes: uniqueEpisodes, failedSeasons };
}