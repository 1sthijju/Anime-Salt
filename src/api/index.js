import { jsonResponse, corsHeaders, BASE_URL, CACHE_TTL_HOME, CACHE_TTL } from './config.js';
import { fetchPage, cachedJSON, getSeriesHtml } from './net.js';
import { 
  extractAnimeList, extractHomeSections, extractPostData, stripScriptsStyles, 
  extractPoster, extractBackdrop, extractQuickPlay 
} from './parsers.js';
import { fetchSeasonEpisodes } from './episodes.js';
import { decryptAsCdn26, decryptAbyss } from './decryptors.js';
import { handleMediaProxy } from './media-proxy.js';

async function getStatusMembership(id, ctx) {
  const ongoing = await cachedJSON("status_ongoing_v2", async () => {
    let slugs = [];
    for (let p = 1; p <= 3; p++) {
      try {
        const html = await fetchPage(`/category/status/ongoing/page/${p}/`);
        slugs.push(...extractAnimeList(stripScriptsStyles(html)).map(c => c.id));
      } catch(e) {}
    }
    return slugs;
  }, CACHE_TTL, ctx);
  if (ongoing.includes(id)) return "Ongoing";
  
  const completed = await cachedJSON("status_completed_v2", async () => {
    let slugs = [];
    for (let p = 1; p <= 3; p++) {
      try {
        const html = await fetchPage(`/category/status/completed/page/${p}/`);
        slugs.push(...extractAnimeList(stripScriptsStyles(html)).map(c => c.id));
      } catch(e) {}
    }
    return slugs;
  }, CACHE_TTL, ctx);
  if (completed.includes(id)) return "Completed";
  
  return "Unknown";
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);
    const path = url.pathname;
    
    try {
      if (path === "/") return jsonResponse({ name: "AnimeSalt Edge API", version: "1.3.0", upstream_proxy: BASE_URL });
      
      if (path === "/api/health") {
        const start = Date.now();
        try { 
          await fetchPage("/"); 
          return jsonResponse({ success: true, status: "ok", upstream: { source: BASE_URL, online: true, latencyMs: Date.now() - start } }); 
        } catch (e) { 
          return jsonResponse({ success: false, status: "error", upstream: { source: BASE_URL, online: false, error: e.message } }, 500); 
        }
      }
      
      if (path === "/api/home") {
        const data = await cachedJSON("home_html_v2", async () => extractHomeSections(await fetchPage("/")), CACHE_TTL_HOME, ctx);
        return jsonResponse({ success: true, data });
      }
      
      if (path === "/api/search") {
        const kw = url.searchParams.get("keyword") || "", page = url.searchParams.get("page") || "1";
        const html = await cachedJSON(`search_v2_${kw}_${page}`, async () => fetchPage("/", { s: kw, paged: page }), CACHE_TTL, ctx);
        return jsonResponse({ success: true, page: parseInt(page), data: extractAnimeList(stripScriptsStyles(html)) });
      }
      
      if (path === "/api/info") {
        const id = url.searchParams.get("id");
        if (!id) return jsonResponse({ error: "Missing id" }, 400);
        
        let dataObj;
        try {
          dataObj = await cachedJSON(`info_v2_${id}`, async () => getSeriesHtml(id), CACHE_TTL, ctx);
        } catch(e) {
          if (e.message === "Not Found") return jsonResponse({ error: "Not Found" }, 404);
          throw e;
        }
        
        const { html, type } = dataObj;
        const cleanHtml = stripScriptsStyles(html);
        
        let title = id;
        const titleMatch = cleanHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (titleMatch) title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
        
        const poster = extractPoster(cleanHtml);
        const backdrop = extractBackdrop(cleanHtml);
        const overviewMatch = cleanHtml.match(/<div[^>]*id="overview-text"[^>]*>([\s\S]*?)<\/div>/i);
        const description = overviewMatch ? overviewMatch[1].replace(/<[^>]+>/g, '').trim() : "";
        const text = cleanHtml.replace(/<[^>]+>/g, ' ');
        
        const runtimeMatch = text.match(/(\d+)\s+min/i);
        let year = "";
        if (runtimeMatch) {
          const idx = text.indexOf(runtimeMatch[0]);
          const snippet = text.substring(idx, idx + 50);
          const y = snippet.match(/(\d{4})/);
          if (y) year = y[1];
        }
        if (!year) { const jsonLd = cleanHtml.match(/"datePublished"\s*:\s*"([^"]+)"/i); if (jsonLd) year = jsonLd[1].substring(0, 4); }
        if (!year) {
          const years = text.match(/\b(19|20)\d{2}\b/g);
          if (years) { const valid = years.filter(y => parseInt(y) >= 1950 && parseInt(y) <= 2024).sort(); if (valid.length) year = valid[0]; }
        }
        
        const genres = [], langArr = [];
        const genreMatches = cleanHtml.match(/<a[^>]+href="[^"]*\/category\/genre\/[^"]+"[^>]*>([^<]+)<\/a>/gi);
        if (genreMatches) genreMatches.forEach(m => { const t = m.match(/>([^<]+)</); if (t) genres.push(t[1].trim()); });
        const langMatches = cleanHtml.match(/<a[^>]+href="[^"]*\/category\/language\/[^"]+"[^>]*>([^<]+)<\/a>/gi);
        if (langMatches) langMatches.forEach(m => { const t = m.match(/>([^<]+)</); if (t) langArr.push(t[1].trim()); });
        
        const seasons = []; let totalEpisodes = 0;
        const seasonTabRegex = /Season\s+(\d+)\s*[•·]?\s*(\d+)\s*[-–]\s*(\d+)\s*\((\d+)\)(\s*\[[^\]]+\])?/gi;
        let tabMatch;
        while ((tabMatch = seasonTabRegex.exec(cleanHtml)) !== null) {
          const num = parseInt(tabMatch[1]); totalEpisodes += parseInt(tabMatch[4]);
          seasons.push({ num, title: `Season ${num}`, value: num });
        }
        
        const episodesMatch = text.match(/(\d+)\s+Episodes?/i);
        const seasonsMatch = text.match(/(\d+)\s+Seasons?/i);
        if (totalEpisodes === 0 && episodesMatch) totalEpisodes = parseInt(episodesMatch[1]);
        if (seasons.length === 0 && seasonsMatch) {
          for(let i=1; i<=parseInt(seasonsMatch[1]); i++) seasons.push({ num: i, title: `Season ${i}`, value: i });
        }
        
        let status = "Unknown";
        if (type === "movies") status = "Released";
        else {
          const statusLabel = text.match(/Status:\s*([A-Za-z\s]+)/i);
          if (statusLabel) status = statusLabel[1].trim();
          else status = await getStatusMembership(id, ctx);
          if (status === "Unknown" && totalEpisodes >= 100) status = "Ongoing";
        }
        
        return jsonResponse({
          success: true, data: { id, title, poster, backdrop, description, type, totalEpisodes, year, status, seasons, genres, languages: langArr, runtime: runtimeMatch ? runtimeMatch[0] : "", quickPlay: extractQuickPlay(text) }
        });
      }
      
      if (path.startsWith("/api/episodes/")) {
        const id = path.split("/")[3]; const season = url.searchParams.get("season") || "1";
        
        let dataObj;
        try {
          dataObj = await cachedJSON(`info_v2_${id}`, async () => getSeriesHtml(id), CACHE_TTL, ctx);
        } catch(e) {
          if (e.message === "Not Found") return jsonResponse({ error: "Not Found" }, 404);
          throw e;
        }
        
        const { html, type } = dataObj;
        
        if (type === "movies") {
          const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
          const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : id;
          const poster = extractPoster(stripScriptsStyles(html));
          return jsonResponse({ success: true, data: { animeId: id, requestedSeason: 1, availableSeasons: [1], totalEpisodes: 1, failedSeasons: [], groupedEpisodes: { "1": [{ num: 1, season: 1, title, slug: id, url: `/movies/${id}/`, image: poster, regionalDub: true }] }, isMovie: true } });
        }
        
        const { postId, nonce } = extractPostData(html);
        if (!postId || !nonce) return jsonResponse({ success: true, data: { animeId: id, requestedSeason: parseInt(season), availableSeasons: [], totalEpisodes: 0, failedSeasons: [parseInt(season)], groupedEpisodes: {} } });
        
        const seasonNum = parseInt(season);
        const episodes = await fetchSeasonEpisodes(postId, nonce, seasonNum);
        return jsonResponse({ success: true, data: { animeId: id, requestedSeason: seasonNum, availableSeasons: [seasonNum], totalEpisodes: episodes.length, failedSeasons: [], groupedEpisodes: { [seasonNum]: episodes } } });
      }

      if (path === "/api/servers") {
        const ep = url.searchParams.get("ep");
        if (!ep) return jsonResponse({ error: "Missing ep" }, 400);
        let html = "";
        for (const prefix of ["episode", "movies", "series"]) {
          try {
            const text = await cachedJSON(`play_v2_${prefix}_${ep}`, async () => fetchPage(`/${prefix}/${ep}/`), CACHE_TTL, ctx);
            if (!text.includes("404 Not Found")) { html = text; break; }
          } catch(e) {}
        }
        if (!html) return jsonResponse({ data: [] });

        const servers = [];
        const serverBtns = [...html.matchAll(/<div[^>]*class="server-btn"[^>]*onclick="changeServer\((\d+)\)"[^>]*>([\s\S]*?)<\/div>/gi)];
        for (const btn of serverBtns) {
          const index = parseInt(btn[1]); const serverName = btn[2].replace(/<[^>]+>/g, '').trim();
          const optionRegex = new RegExp(`<div[^>]*id="options-${index}"[^>]*>([\\s\\S]*?)<\\/div>`, "i");
          const optMatch = html.match(optionRegex);
          if (!optMatch) continue;
          const iframeMatch = optMatch[1].match(/<iframe[^>]+(?:src|data-src)="([^"]+)"/i);
          if (!iframeMatch) continue;
          
          let embedUrl = iframeMatch[1]; if (embedUrl.startsWith("//")) embedUrl = "https:" + embedUrl;
          let isMultiLang = false, languages = [];
          const multiLangMatch = embedUrl.match(/multi-lang-plyr\/player\.php\?data=([^&]+)/i);
          if (multiLangMatch) {
            try {
              const parsed = JSON.parse(atob(multiLangMatch[1])); isMultiLang = true;
              languages = parsed.map(l => ({ language: l.language || l.lang || "Unknown", link: l.link.startsWith("//") ? "https:" + l.link : l.link }));
            } catch(e) {}
          }
          servers.push({ index, serverName, embedUrl, isMultiLang, languages });
        }
        return jsonResponse({ success: true, data: servers });
      }

      if (path === "/api/stream") {
        const ep = url.searchParams.get("ep"), serverIdx = parseInt(url.searchParams.get("server") || "0"), targetLang = url.searchParams.get("lang") || "eng";
        let html = "";
        for (const prefix of ["episode", "movies", "series"]) {
          try {
            const text = await cachedJSON(`play_v2_${prefix}_${ep}`, async () => fetchPage(`/${prefix}/${ep}/`), CACHE_TTL, ctx);
            if (!text.includes("404 Not Found")) { html = text; break; }
          } catch(e) {}
        }
        
        let embedUrl = "";
        const serverBtns = [...html.matchAll(/<div[^>]*class="server-btn"[^>]*onclick="changeServer\((\d+)\)"[^>]*>([\s\S]*?)<\/div>/gi)];
        for (const btn of serverBtns) {
          if (parseInt(btn[1]) === serverIdx) {
            const optionRegex = new RegExp(`<div[^>]*id="options-${serverIdx}"[^>]*>([\\s\\S]*?)<\\/div>`, "i");
            const optMatch = html.match(optionRegex);
            if (optMatch) {
              const iframeMatch = optMatch[1].match(/<iframe[^>]+(?:src|data-src)="([^"]+)"/i);
              if (iframeMatch) { embedUrl = iframeMatch[1]; if (embedUrl.startsWith("//")) embedUrl = "https:" + embedUrl; }
            }
          }
        }
        if (!embedUrl) return jsonResponse({ error: "Server not found" }, 404);

        const multiLangMatch = embedUrl.match(/multi-lang-plyr\/player\.php\?data=([^&]+)/i);
        if (multiLangMatch) {
          try {
            const parsed = JSON.parse(atob(multiLangMatch[1]));
            const target = parsed.find(l => l.language?.toLowerCase().includes(targetLang) || l.lang?.toLowerCase().includes(targetLang)) || parsed[0];
            embedUrl = target.link.startsWith("//") ? "https:" + target.link : target.link;
          } catch(e) {}
        }

        if (embedUrl.includes("as-cdn26.top")) {
          const decrypted = await decryptAsCdn26(embedUrl);
          if (decrypted.direct_hls) {
            const masterRes = await fetch(decrypted.direct_hls, { headers: { "Referer": BASE_URL } });
            const masterManifest = await masterRes.text();
            const audioLangs = [], subLangs = [];
            const mediaRegex = /#EXT-X-MEDIA:TYPE=(AUDIO|SUBTITLES)[^\n]*NAME="([^"]+)"[^\n]*LANGUAGE="([^"]+)"/gi;
            let m;
            while ((m = mediaRegex.exec(masterManifest)) !== null) {
              if (m[1] === "AUDIO") audioLangs.push(m[3]);
              else if (m[1] === "SUBTITLES") subLangs.push(m[3]);
            }
            
            let proxiedUrl = `/proxy/media?url=${encodeURIComponent(decrypted.direct_hls)}&referer=${encodeURIComponent(BASE_URL)}`;
            if (audioLangs.length > 0) proxiedUrl += `&audio=${encodeURIComponent(audioLangs.includes(targetLang) ? targetLang : audioLangs[0])}`;
            
            return jsonResponse({ success: true, proxied_url: proxiedUrl, host: decrypted.host, isIframe: false, referer: BASE_URL, audio_languages: audioLangs, subtitle_languages: subLangs, selected_audio: audioLangs[0] || "", qualities: decrypted.qualities || [] });
          }
        } else if (embedUrl.includes("abyss") || embedUrl.includes("short.icu") || embedUrl.includes("hydraxcdn")) {
          const decrypted = await decryptAbyss(embedUrl);
          if (decrypted.direct_hls) return jsonResponse({ success: true, proxied_url: `/proxy/media?url=${encodeURIComponent(decrypted.direct_hls)}&referer=${encodeURIComponent(BASE_URL)}`, host: decrypted.host, isIframe: false });
        }

        return jsonResponse({ success: true, embedUrl, isIframe: true, referer: BASE_URL });
      }

      // DEBUG ROUTE FOR AJAX PAYLOAD
      if (path === "/api/debug/ajax") {
        const id = url.searchParams.get("id") || "one-piece";
        try {
          const { html } = await getSeriesHtml(id);
          const { postId, nonce } = extractPostData(html);
          return jsonResponse({ postId, nonce, html_length: html.length });
        } catch(e) {
          return jsonResponse({ error: e.message });
        }
      }
      
      if (path === "/proxy/media") return handleMediaProxy(request);
      
      if (path.startsWith("/api/genre/") || path.startsWith("/api/type/") || path.startsWith("/api/category/")) {
        const html = await cachedJSON(`cat_v2_${path}`, async () => fetchPage(path), CACHE_TTL, ctx);
        return jsonResponse({ success: true, data: extractAnimeList(stripScriptsStyles(html)) });
      }
      
      return jsonResponse({ error: "Not Found" }, 404);
    } catch (e) {
      return jsonResponse({ error: e.message || "Internal Server Error" }, 500);
    }
  }
};