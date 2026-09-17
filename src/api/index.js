import { jsonResponse, corsHeaders, BASE_URL, CACHE_TTL_HOME } from "./config.js";
import { cachedJSON, fetchPage, siteAjax, getSeriesHtml } from "./net.js";
import { extractAnimeList, extractPopularItems, extractEmbedForIndex } from "./parsers.js";
import { getEpisodesData } from "./episodes.js";
import { resolveAsCdn26, resolveAbyss, normalizeAbyssUrl } from "./decryptors.js";
import { CHROME_HEADERS, CACHE_TTL } from "./config.js";   // merge with existing configImport
import { proxyMediaUrl, handleMediaProxy, parseHlsMediaGroups } from "./media-proxy.js";

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);
    const path = url.pathname;
    const params = url.searchParams;

    try {
      if (path === "/") {
        return jsonResponse({
          name: "AnimeSalt Edge API",
          version: "3.3.0",
          endpoints: ["/api/health", "/api/search", "/api/latest-episodes", "/api/popular", "/api/completed", "/api/ongoing", "/api/type/:type", "/api/genre/:category", "/api/info", "/api/episodes/:id", "/api/servers", "/api/stream", "/api/ajax", "/proxy/media"],
        });
      }

      if (path === "/api/health") {
        const t0 = Date.now();
        let upstreamOnline = false, upstreamLatency = 0, upstreamError = null;
        try {
          const html = await fetchPage("/");
          upstreamOnline = typeof html === "string" && (html.includes("animesalt") || html.includes("<html"));
          upstreamLatency = Date.now() - t0;
        } catch (err) { upstreamError = err.message; }
        return jsonResponse({ success: upstreamOnline, status: upstreamOnline ? "healthy" : "degraded", timestamp: new Date().toISOString(), upstream: { source: BASE_URL, online: upstreamOnline, latencyMs: upstreamLatency, error: upstreamError }, version: "3.3.0-edge", endpointsCount: 14 });
      }

      if (path === "/api/search") {
        const keyword = params.get("keyword") || params.get("q");
        const page = parseInt(params.get("page") || "1", 10);
        if (!keyword) return jsonResponse({ success: false, error: "Keyword required" }, 400);
        const p = { s: keyword }; if (page > 1) p.paged = page.toString();
        const data = await cachedJSON(`html:search:${keyword}:${page}`, () => fetchPage("/", p), CACHE_TTL_HOME);
        return jsonResponse({ success: true, page, data: extractAnimeList(data) });
      }

      if (path === "/api/latest-episodes") {
        const data = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
        return jsonResponse({ success: true, data: extractAnimeList(data).slice(0, 20) });
      }

      if (path === "/api/popular") {
        const type = params.get("type");
        const data = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
        let results = extractPopularItems(data, type);
        if (results.length === 0) results = extractAnimeList(data).slice(0, 25).map((r, i) => ({ rank: i + 1, ...r }));
        return jsonResponse({ success: true, data: results });
      }

      if (path === "/api/completed") {
        const page = parseInt(params.get("page") || "1", 10);
        const p = page > 1 ? `/category/status/completed/page/${page}/` : "/category/status/completed/";
        try {
          const data = await cachedJSON(`html:${p}`, () => fetchPage(p), CACHE_TTL_HOME);
          return jsonResponse({ success: true, page, data: extractAnimeList(data) });
        } catch (e) { return jsonResponse({ success: true, page, data: [] }); }
      }

      if (path === "/api/ongoing") {
        const page = parseInt(params.get("page") || "1", 10);
        const p = page > 1 ? `/category/status/ongoing/page/${page}/` : "/category/status/ongoing/";
        try {
          const data = await cachedJSON(`html:${p}`, () => fetchPage(p), CACHE_TTL_HOME);
          return jsonResponse({ success: true, page, data: extractAnimeList(data) });
        } catch (e) { return jsonResponse({ success: true, page, data: [] }); }
      }

      if (path.startsWith("/api/type/")) {
        const type = path.split("/")[3];
        const subtype = params.get("subtype") || "series";
        const page = parseInt(params.get("page") || "1", 10);
        const p = page > 1 ? `/category/type/${type}/page/${page}/` : `/category/type/${type}/`;
        try {
          const data = await cachedJSON(`html:${p}:${subtype}`, () => fetchPage(p, { type: subtype }), CACHE_TTL_HOME);
          return jsonResponse({ success: true, page, type, subtype, data: extractAnimeList(data) });
        } catch (e) { return jsonResponse({ success: true, page, type, subtype, data: [] }); }
      }

      if (path.startsWith("/api/genre/")) {
        const category = path.split("/")[3];
        const page = parseInt(params.get("page") || "1", 10);
        const p = page > 1 ? `/category/genre/${category}/page/${page}/` : `/category/genre/${category}/`;
        try {
          const data = await cachedJSON(`html:${p}`, () => fetchPage(p), CACHE_TTL_HOME);
          return jsonResponse({ success: true, page, genre: category, data: extractAnimeList(data) });
        } catch (e) { return jsonResponse({ success: true, page, genre: category, data: [] }); }
      }

      if (path === "/api/info") {
        const animeId = params.get("id") || params.get("slug");
        if (!animeId) return jsonResponse({ success: false, error: "Anime ID (slug) is required" }, 400);
        let data, type = "series";
        try { data = await getSeriesHtml(animeId); }
        catch (e) { data = await cachedJSON(`html:movies:${animeId}`, () => fetchPage(`/movies/${animeId}/`)); type = "movies"; }

        const titleMatch = data.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) || data.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : "Unknown";
        const posterMatch = data.match(/<img[^>]*class="[^"]*(?:wp-post-image|poster)[^"]*"[^>]*(?:data-src|src)="([^"]+)"/i);
        let poster = posterMatch ? posterMatch[1] : ""; if (poster.startsWith("//")) poster = "https:" + poster;
        const descMatch = data.match(/<div[^>]*id="overview-text"[^>]*>([\s\S]*?)<\/div>/i) || data.match(/<div[^>]*class="[^"]*(?:synopsis|overview)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : "";
        const genres = []; const genreRegex = /href="[^"]*\/category\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/gi; let match;
        while ((match = genreRegex.exec(data)) !== null) { const g = match[1].trim(); if (g && !genres.includes(g)) genres.push(g); }
        const languages = []; const langRegex = /href="[^"]*\/category\/language\/[^"]*"[^>]*>([^<]+)<\/a>/gi;
        while ((match = langRegex.exec(data)) !== null) { const l = match[1].trim(); if (l && !languages.includes(l)) languages.push(l); }
        const yearMatch = data.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
        const statusMatch = data.match(/Status[^<]*<[^>]*>([^<]+)/i);

        let seasons = [], totalEpisodes = 0;
        if (type === "series") {
          try { const epData = await getEpisodesData(animeId, "all"); seasons = epData.seasons; totalEpisodes = epData.episodes.length; } catch (e) {}
        } else { totalEpisodes = 1; }

        return jsonResponse({ success: true, data: { id: animeId, title, poster, description, type, totalEpisodes, year: yearMatch ? parseInt(yearMatch[0]) : null, status: statusMatch ? statusMatch[1].trim() : "Unknown", seasons, genres, languages } });
      }

      if (path.startsWith("/api/episodes/")) {
        const animeId = path.split("/")[3];
        const seasonParam = params.get("season");
        const requestedSeason = seasonParam ? parseInt(seasonParam, 10) : "all";
        const { episodes, seasons, failedSeasons } = await getEpisodesData(animeId, requestedSeason);

        const groupedEpisodes = {};
        for (const ep of episodes) {
          if (!groupedEpisodes[ep.season]) groupedEpisodes[ep.season] = [];
          groupedEpisodes[ep.season].push(ep);
        }

        return jsonResponse({ success: true, data: { animeId, requestedSeason, availableSeasons: seasons.map(s => s.num), totalEpisodes: episodes.length, failedSeasons, groupedEpisodes } });
      }

      // =====================================================================
      // /api/servers — uses extractEmbedForIndex for robust iframe discovery
      // =====================================================================
      if (path === "/api/servers") {
        const epSlug = params.get("ep");
        if (!epSlug) return jsonResponse({ success: false, error: "Episode slug (ep) is required" }, 400);
        const data = await cachedJSON(`html:episode:${epSlug}`, () => fetchPage(`/episode/${epSlug}/`));
        const servers = [];
        const serverRegex = /<div[^>]*class="[^"]*server-btn[^"]*"[^>]*onclick="changeServer\((\d+)\)"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
        let match;
        while ((match = serverRegex.exec(data)) !== null) {
          const index = parseInt(match[1]);
          const serverHtml = match[2];
          const nameMatch = serverHtml.match(/class="[^"]*server-name[^"]*"[^>]*>([^<]+)/i);
          const infoMatch = serverHtml.match(/class="[^"]*server-info[^"]*"[^>]*>([^<]+)/i);
          const serverNameHeader = nameMatch ? nameMatch[1].trim() : `SERVER ${index + 1}`;
          const serverInfo = infoMatch ? infoMatch[1].trim() : "";
          const fullName = serverInfo ? `${serverNameHeader} - ${serverInfo}` : serverNameHeader;

          const embedUrl = extractEmbedForIndex(data, index);

          let languages = [];
          if (embedUrl && embedUrl.includes("multi-lang-plyr/player.php?data=")) {
            try {
              const b64Match = embedUrl.match(/data=([A-Za-z0-9+/=]+)/);
              if (b64Match && b64Match[1]) {
                const parsed = JSON.parse(atob(b64Match[1]));
                languages = Array.isArray(parsed) ? parsed.map(l => ({ ...l, link: normalizeAbyssUrl(l.link) })) : [];
              }
            } catch (e) {}
          }
          servers.push({ index, serverName: fullName, embedUrl: embedUrl || null, isMultiLang: languages.length > 0, languages });
        }
        return jsonResponse({ success: true, data: servers });
      }

      // =====================================================================
      // /api/stream — uses extractEmbedForIndex for robust iframe discovery
      // =====================================================================
      if (path === "/api/stream") {
        const epSlug = params.get("ep");
        const serverParam = params.get("server") || "0";
        const lang = params.get("lang");
        if (!epSlug) return jsonResponse({ success: false, error: "Episode slug (ep) is required" }, 400);
        const data = await cachedJSON(`html:episode:${epSlug}`, () => fetchPage(`/episode/${epSlug}/`));
        const serverIndex = parseInt(serverParam, 10);

        let embedUrl = extractEmbedForIndex(data, serverIndex) || null;
        let selectedLanguage = null;

        if (embedUrl && embedUrl.includes("multi-lang-plyr/player.php?data=")) {
          try {
            const b64Match = embedUrl.match(/data=([A-Za-z0-9+/=]+)/);
            if (b64Match && b64Match[1]) {
              const parsed = JSON.parse(atob(b64Match[1]));
              const languages = Array.isArray(parsed) ? parsed : [];
              if (languages.length > 0) {
                if (lang) {
                  const m = languages.find(l => l.language?.toLowerCase() === lang.toLowerCase());
                  if (m) { embedUrl = normalizeAbyssUrl(m.link); selectedLanguage = m.language; }
                } else {
                  const eng = languages.find(l => l.language?.toLowerCase().includes("eng"));
                  if (eng) { embedUrl = normalizeAbyssUrl(eng.link); selectedLanguage = eng.language; }
                }
              }
            }
          } catch (e) {}
        }
        if (embedUrl && embedUrl.startsWith("//")) embedUrl = "https:" + embedUrl;

        let resolvedStream = null;
        if (embedUrl) {
          try {
            if (embedUrl.includes("as-cdn26.top")) {
              resolvedStream = await resolveAsCdn26(embedUrl);
            } else if (/(short\.icu|short\.ink|abysscdn\.com|hydraxcdn\.biz|embedplayabyss\.top|abyssplayer\.com)/.test(embedUrl)) {
              resolvedStream = await resolveAbyss(embedUrl);
            }
          } catch (e) { console.warn(`Decryptor failed: ${e.message}`); }
        }
        if (resolvedStream) {
          const workerOrigin = new URL(request.url).origin;
          const primary = resolvedStream.direct_hls || resolvedStream.qualities?.[0]?.url || null;
          return jsonResponse({
            success: true,
            data: {
              ...resolvedStream,
              proxied_url: primary ? proxyMediaUrl(workerOrigin, primary) : null,
              serverIndex,
              selectedLanguage,
              isIframe: false,
              referer: resolvedStream.host === "as-cdn26.top" ? "https://as-cdn26.top/" : "https://abyssplayer.com/",
            },
          });
        }
        return jsonResponse({ success: true, data: { embedUrl, serverIndex, selectedLanguage, isIframe: true, referer: `${BASE_URL}/episode/${epSlug}/` } });
      }

      if (path === "/api/ajax") {
        const action = params.get("action");
        if (!action) return jsonResponse({ success: false, error: "action required" }, 400);
        const passthrough = {};
        for (const [k, v] of params.entries()) passthrough[k] = v;
        const frag = await siteAjax(passthrough);
        return new Response(frag, { headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders } });
      }

      if (path === "/proxy/media") {
        return await handleMediaProxy(request);
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (e) {
      return jsonResponse({ error: e.message, stack: e.stack }, 500);
    }
  }
};