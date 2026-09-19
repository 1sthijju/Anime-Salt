import { jsonResponse, corsHeaders, BASE_URL, CACHE_TTL_HOME, CACHE_TTL } from './config.js';
import { fetchPage, cachedJSON, getSeriesHtml } from './net.js';
import { 
  extractAnimeList, extractHomeSections, extractPostData, stripScriptsStyles, 
  extractPoster, extractBackdrop, extractQuickPlay 
} from './parsers.js';
import { fetchSeasonEpisodes } from './episodes.js';
import { decryptAsCdn26, decryptAbyss } from './decryptors.js';
import { handleMediaProxy } from './media-proxy.js';

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    
    const url = new URL(request.url);
    const path = url.pathname;
    
    try {
      if (path === "/") {
        return jsonResponse({
          name: "AnimeSalt Edge API",
          version: "1.0.1",
          upstream_proxy: BASE_URL,
          endpoints: [
            "/api/health", "/api/search", "/api/home", "/api/latest-episodes",
            "/api/fresh-drops", "/api/popular", "/api/series", "/api/movies",
            "/api/genres", "/api/info", "/api/episodes", "/api/servers",
            "/api/stream", "/proxy/media"
          ]
        });
      }
      
      if (path === "/api/health") {
        const start = Date.now();
        try {
          await fetchPage("/");
          return jsonResponse({
            success: true,
            status: "ok",
            upstream: { source: BASE_URL, online: true, latencyMs: Date.now() - start }
          });
        } catch (e) {
          return jsonResponse({
            success: false,
            status: "error",
            upstream: { source: BASE_URL, online: false, error: e.message }
          }, 500);
        }
      }
      
      if (path === "/api/home") {
        const data = await cachedJSON("home_html", async () => {
          const html = await fetchPage("/");
          return extractHomeSections(html);
        }, CACHE_TTL_HOME);
        return jsonResponse({ success: true, data });
      }
      
      if (path === "/api/search") {
        const kw = url.searchParams.get("keyword") || "";
        const page = url.searchParams.get("page") || "1";
        const html = await cachedJSON(`search_${kw}_${page}`, async () => {
          return fetchPage("/", { s: kw, paged: page });
        }, CACHE_TTL);
        return jsonResponse({
          success: true, page: parseInt(page),
          data: extractAnimeList(stripScriptsStyles(html))
        });
      }
      
      if (path === "/api/info") {
        const id = url.searchParams.get("id");
        if (!id) return jsonResponse({ error: "Missing id" }, 400);
        
        const { html, type } = await cachedJSON(`info_${id}`, async () => {
          return getSeriesHtml(id);
        }, CACHE_TTL);
        
        const cleanHtml = stripScriptsStyles(html);
        const titleMatch = cleanHtml.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([^<]+)</i);
        const title = titleMatch ? titleMatch[1].trim() : id;
        
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
        if (!year) {
          const jsonLd = cleanHtml.match(/"datePublished"\s*:\s*"([^"]+)"/i);
          if (jsonLd) year = jsonLd[1].substring(0, 4);
        }
        if (!year) {
          const years = text.match(/\b(19|20)\d{2}\b/g);
          if (years) {
            const valid = years.filter(y => parseInt(y) >= 1950 && parseInt(y) <= 2024).sort();
            if (valid.length) year = valid[0];
          }
        }
        
        const genres = [];
        const genreMatches = cleanHtml.match(/<a[^>]+href="[^"]*\/category\/genre\/[^"]+"[^>]*>([^<]+)<\/a>/gi);
        if (genreMatches) {
          genreMatches.forEach(m => {
            const t = m.match(/>([^<]+)</);
            if (t) genres.push(t[1].trim());
          });
        }
        
        const seasons = [];
        let totalEpisodes = 0;
        const seasonTabRegex = /Season\s+(\d+)\s*[•·]?\s*(\d+)\s*[-–]\s*(\d+)\s*\((\d+)\)(\s*\[[^\]]+\])?/gi;
        let tabMatch;
        while ((tabMatch = seasonTabRegex.exec(cleanHtml)) !== null) {
          const num = parseInt(tabMatch[1]);
          const count = parseInt(tabMatch[4]);
          totalEpisodes += count;
          seasons.push({ num, title: `Season ${num}`, value: num });
        }
        
        const episodesMatch = text.match(/(\d+)\s+Episodes?/i);
        if (totalEpisodes === 0 && episodesMatch) totalEpisodes = parseInt(episodesMatch[1]);
        
        let status = "Unknown";
        if (type === "movies") status = "Released";
        else {
          if (text.includes("Status:")) {
            const statusMatch = text.match(/Status:\s*([A-Za-z]+)/i);
            if (statusMatch) status = statusMatch[1];
          }
          if (status === "Unknown" && totalEpisodes >= 100) status = "Ongoing";
        }
        
        return jsonResponse({
          success: true, data: {
            id, title, poster, backdrop, description, type,
            totalEpisodes, year, status, seasons, genres,
            runtime: runtimeMatch ? runtimeMatch[0] : "",
            quickPlay: extractQuickPlay(text)
          }
        });
      }
      
      if (path.startsWith("/api/episodes/")) {
        const id = path.split("/")[3];
        const season = url.searchParams.get("season") || "1";
        
        const { html, type } = await cachedJSON(`info_${id}`, async () => {
          return getSeriesHtml(id);
        }, CACHE_TTL);
        
        if (type === "movies") {
          const titleMatch = html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([^<]+)</i);
          const title = titleMatch ? titleMatch[1].trim() : id;
          const poster = extractPoster(stripScriptsStyles(html));
          return jsonResponse({
            success: true,
            data: {
              animeId: id, requestedSeason: 1, availableSeasons: [1], totalEpisodes: 1,
              failedSeasons: [],
              groupedEpisodes: {
                "1": [{ num: 1, season: 1, title, slug: id, url: `/movies/${id}/`, image: poster, regionalDub: true }]
              },
              isMovie: true
            }
          });
        }
        
        const { postId, nonce } = extractPostData(html);
        const seasonNum = parseInt(season);
        const episodes = await fetchSeasonEpisodes(postId, nonce, seasonNum);
        
        return jsonResponse({
          success: true,
          data: {
            animeId: id, requestedSeason: seasonNum, availableSeasons: [seasonNum],
            totalEpisodes: episodes.length, failedSeasons: [],
            groupedEpisodes: { [seasonNum]: episodes }
          }
        });
      }

      if (path === "/api/servers") {
        const ep = url.searchParams.get("ep");
        if (!ep) return jsonResponse({ error: "Missing ep" }, 400);
        
        let html = "";
        // Tries episode, movie, or series pages to find server containers
        for (const prefix of ["episode", "movies", "series"]) {
          try {
            const text = await cachedJSON(`play_${prefix}_${ep}`, async () => fetchPage(`/${prefix}/${ep}/`), CACHE_TTL);
            if (!text.includes("404 Not Found")) { html = text; break; }
          } catch(e) {}
        }
        if (!html) return jsonResponse({ data: [] });

        const servers = [];
        const serverBtns = [...html.matchAll(/<div[^>]*class="server-btn"[^>]*onclick="changeServer\((\d+)\)"[^>]*>([\s\S]*?)<\/div>/gi)];
        
        for (const btn of serverBtns) {
          const index = parseInt(btn[1]);
          const serverName = btn[2].replace(/<[^>]+>/g, '').trim();
          
          const optionRegex = new RegExp(`<div[^>]*id="options-${index}"[^>]*>([\\s\\S]*?)<\\/div>`, "i");
          const optMatch = html.match(optionRegex);
          if (!optMatch) continue;
          
          const iframeMatch = optMatch[1].match(/<iframe[^>]+(?:src|data-src)="([^"]+)"/i);
          if (!iframeMatch) continue;
          
          let embedUrl = iframeMatch[1];
          if (embedUrl.startsWith("//")) embedUrl = "https:" + embedUrl;
          
          let isMultiLang = false;
          let languages = [];
          const multiLangMatch = embedUrl.match(/multi-lang-plyr\/player\.php\?data=([^&]+)/i);
          
          if (multiLangMatch) {
            try {
              const decoded = atob(multiLangMatch[1]);
              const parsed = JSON.parse(decoded);
              isMultiLang = true;
              languages = parsed.map(l => ({
                language: l.language || l.lang || "Unknown",
                link: l.link.startsWith("//") ? "https:" + l.link : l.link
              }));
            } catch(e) {}
          }
          
          servers.push({ index, serverName, embedUrl, isMultiLang, languages });
        }
        return jsonResponse({ success: true, data: servers });
      }

      if (path === "/api/stream") {
        const ep = url.searchParams.get("ep");
        const serverIdx = parseInt(url.searchParams.get("server") || "0");
        const targetLang = url.searchParams.get("lang") || "eng";
        
        // Get servers data directly
        let html = "";
        for (const prefix of ["episode", "movies", "series"]) {
          try {
            const text = await cachedJSON(`play_${prefix}_${ep}`, async () => fetchPage(`/${prefix}/${ep}/`), CACHE_TTL);
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
              if (iframeMatch) {
                embedUrl = iframeMatch[1];
                if (embedUrl.startsWith("//")) embedUrl = "https:" + embedUrl;
              }
            }
          }
        }
        
        if (!embedUrl) return jsonResponse({ error: "Server not found" }, 404);

        // Check for multi-lang wrapper
        const multiLangMatch = embedUrl.match(/multi-lang-plyr\/player\.php\?data=([^&]+)/i);
        if (multiLangMatch) {
          try {
            const parsed = JSON.parse(atob(multiLangMatch[1]));
            const target = parsed.find(l => l.language?.toLowerCase().includes(targetLang) || l.lang?.toLowerCase().includes(targetLang)) || parsed[0];
            embedUrl = target.link.startsWith("//") ? "https:" + target.link : target.link;
          } catch(e) {}
        }

        // Decrypt specific hosts
        if (embedUrl.includes("as-cdn26.top")) {
          const decrypted = await decryptAsCdn26(embedUrl);
          if (decrypted.direct_hls) {
            return jsonResponse({
              success: true,
              direct_hls: decrypted.direct_hls,
              proxied_url: `/proxy/media?url=${encodeURIComponent(decrypted.direct_hls)}&referer=${encodeURIComponent(BASE_URL)}`,
              host: decrypted.host,
              isIframe: false
            });
          }
        } else if (embedUrl.includes("abyss") || embedUrl.includes("short.icu") || embedUrl.includes("hydraxcdn")) {
          const decrypted = await decryptAbyss(embedUrl);
          if (decrypted.direct_hls) {
             return jsonResponse({
              success: true,
              proxied_url: `/proxy/media?url=${encodeURIComponent(decrypted.direct_hls)}&referer=${encodeURIComponent(BASE_URL)}`,
              host: decrypted.host,
              isIframe: false
            });
          }
        }

        // Fallback to iframe
        return jsonResponse({
          success: true,
          embedUrl,
          isIframe: true,
          referer: BASE_URL
        });
      }
      
      if (path === "/proxy/media") {
        return handleMediaProxy(request);
      }
      
      // Default catch-all for generic taxonomy/catalog paths
      if (path.startsWith("/api/genre/") || path.startsWith("/api/type/") || path.startsWith("/api/category/")) {
        const html = await cachedJSON(path, async () => fetchPage(path), CACHE_TTL);
        return jsonResponse({ success: true, data: extractAnimeList(stripScriptsStyles(html)) });
      }
      
      return jsonResponse({ error: "Not Found" }, 404);
      
    } catch (e) {
      return jsonResponse({ error: e.message || "Internal Server Error" }, 500);
    }
  }
};