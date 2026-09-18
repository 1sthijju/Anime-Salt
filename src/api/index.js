import { jsonResponse, corsHeaders, BASE_URL, CACHE_TTL_HOME, CACHE_TTL, CHROME_HEADERS } from "./config.js";
import { cachedJSON, fetchPage, siteAjax, getSeriesHtml } from "./net.js";
import { extractAnimeList, extractPopularItems, extractEmbedForIndex, extractTaxonomy } from "./parsers.js";
import { getEpisodesData } from "./episodes.js";
import { resolveAsCdn26, resolveAbyss, normalizeAbyssUrl } from "./decryptors.js";
import { proxyMediaUrl, handleMediaProxy, parseHlsMediaGroups } from "./media-proxy.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function getMasterInfo(masterUrl) {
  return await cachedJSON(`masterinfo:${masterUrl}`, async () => {
    try {
      const r = await fetch(masterUrl, {
        headers: {
          "User-Agent": CHROME_HEADERS["User-Agent"],
          "Referer": "https://as-cdn26.top/",
          "Origin": "https://as-cdn26.top"
        },
      });
      return parseHlsMediaGroups(await r.text());
    } catch (e) {
      return { audio: [], subtitles: [] };
    }
  }, CACHE_TTL);
}

// Generic paginated category resolver with fallback URL prefixes
async function categoryPage(path, tax, params, altPrefixes = []) {
  const term = path.split("/")[3];
  if (!term) return jsonResponse({ success: false, error: "Term required" }, 400);
  const page = parseInt(params.get("page") || "1", 10);
  const bases = [`/category/${tax}/${term}/`, ...altPrefixes.map(a => `${a}${term}/`)];
  for (const base of bases) {
    const p = page > 1 ? `${base}page/${page}/` : base;
    try {
      const data = await cachedJSON(`html:${p}`, () => fetchPage(p), CACHE_TTL_HOME);
      const items = extractAnimeList(data);
      if (items.length) return jsonResponse({ success: true, page, term, data: items });
    } catch (e) { /* try next prefix */ }
  }
  return jsonResponse({ success: true, page, term, data: [] });
}

// ---------------------------------------------------------------------------
// Worker entry
// ---------------------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);
    const path = url.pathname;
    const params = url.searchParams;

    try {
      // ====================================================================
      // Index
      // ====================================================================
      if (path === "/") {
        return jsonResponse({
          name: "AnimeSalt Edge API",
          version: "3.9.0",
          endpoints: {
            system: ["/api/health", "/api/ajax", "/proxy/media"],
            home: ["/api/home", "/api/latest-episodes", "/api/fresh-drops"],
            charts: ["/api/popular", "/api/popular/films", "/api/popular/series"],
            browse: ["/api/series", "/api/movies", "/api/anime", "/api/cartoon", "/api/ongoing", "/api/completed"],
            taxonomy_lists: ["/api/genres", "/api/languages", "/api/countries", "/api/discover"],
            taxonomy_pages: [
              "/api/genre/:g", "/api/type/:t", "/api/country/:c", "/api/language/:l",
              "/api/quality/:q", "/api/season/:s", "/api/studio/:st", "/api/year/:y",
              "/api/category/:tax/:term"
            ],
            detail: ["/api/info?id=", "/api/episodes/:id", "/api/servers?ep=", "/api/stream?ep="],
            misc: ["/api/search?keyword=", "/api/random"],
          },
        });
      }

      // ====================================================================
      // Health
      // ====================================================================
      if (path === "/api/health") {
        const t0 = Date.now();
        let upstreamOnline = false, upstreamLatency = 0, upstreamError = null;
        try {
          const html = await fetchPage("/");
          upstreamOnline = typeof html === "string" && (html.includes("animesalt") || html.includes("<html"));
          upstreamLatency = Date.now() - t0;
        } catch (err) { upstreamError = err.message; }
        return jsonResponse({
          success: upstreamOnline,
          status: upstreamOnline ? "healthy" : "degraded",
          timestamp: new Date().toISOString(),
          upstream: { source: BASE_URL, online: upstreamOnline, latencyMs: upstreamLatency, error: upstreamError },
          version: "3.9.0-edge",
          endpointsCount: 30
        });
      }

      // ====================================================================
      // Search
      // ====================================================================
      if (path === "/api/search") {
        const keyword = params.get("keyword") || params.get("q");
        const page = parseInt(params.get("page") || "1", 10);
        if (!keyword) return jsonResponse({ success: false, error: "Keyword required" }, 400);
        const p = { s: keyword }; if (page > 1) p.paged = page.toString();
        const data = await cachedJSON(`html:search:${keyword}:${page}`, () => fetchPage("/", p), CACHE_TTL_HOME);
        return jsonResponse({ success: true, page, data: extractAnimeList(data) });
      }

      // ====================================================================
      // Home (complete: 8 sections) — FIXED: multi-path movies + type detection
      // ====================================================================
      if (path === "/api/home") {
        // Try multiple movie paths since /category/type/movies/ may not exist
        let moviesHtml = "";
        for (const moviePath of ["/category/type/movies/", "/movies/", "/type/movie/"]) {
          try {
            const data = await fetchPage(moviePath);
            const items = extractAnimeList(data);
            if (items.length) { moviesHtml = data; break; }
          } catch (e) { /* try next */ }
        }

        const [homeData, ongoingData, completedData, freshData] = await Promise.all([
          cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME),
          cachedJSON("html:/category/status/ongoing/", () => fetchPage("/category/status/ongoing/"), CACHE_TTL_HOME).catch(() => ""),
          cachedJSON("html:/category/status/completed/", () => fetchPage("/category/status/completed/"), CACHE_TTL_HOME).catch(() => ""),
          cachedJSON("html:/category/status/fresh-drops/", () => fetchPage("/category/status/fresh-drops/"), CACHE_TTL_HOME).catch(() => ""),
        ]);

        const latest = extractAnimeList(homeData).slice(0, 20);

        // Build popular list with CORRECT type detection based on URL
        let popular = extractPopularItems(homeData);
        if (popular.length === 0) {
          popular = extractAnimeList(homeData).slice(0, 50).map((r, i) => ({ rank: i + 1, ...r }));
        }

        // FIX: Re-detect type from URL since extractPopularItems may miss /movies/ URLs
        popular = popular.map(item => ({
          ...item,
          type: item.url && item.url.includes("/movies/") ? "movie" : (item.type || "series")
        }));

        const popularSeries = popular.filter(i => i.type === "series").slice(0, 12);
        const popularFilms = popular.filter(i => i.type === "movie").slice(0, 12);

        return jsonResponse({
          success: true,
          data: {
            latest,
            popular,
            popularSeries,
            popularFilms,
            ongoing: ongoingData ? extractAnimeList(ongoingData).slice(0, 18) : [],
            completed: completedData ? extractAnimeList(completedData).slice(0, 18) : [],
            movies: moviesHtml ? extractAnimeList(moviesHtml).slice(0, 18) : [],
            freshDrops: freshData ? extractAnimeList(freshData).slice(0, 18) : [],
          },
        });
      }

      if (path === "/api/latest-episodes") {
        const data = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
        return jsonResponse({ success: true, data: extractAnimeList(data).slice(0, 20) });
      }

      // ====================================================================
      // Fresh Drops (tries multiple "recent" paths)
      // ====================================================================
      if (path === "/api/fresh-drops") {
        const page = parseInt(params.get("page") || "1", 10);
        const prefixes = [
          "/category/status/fresh-drops/",
          "/new/",
          "/recent/",
          "/latest/",
          "/category/status/recently-added/"
        ];
        for (const base of prefixes) {
          const p = page > 1 ? `${base}page/${page}/` : base;
          try {
            const data = await cachedJSON(`html:${p}`, () => fetchPage(p), CACHE_TTL_HOME);
            const items = extractAnimeList(data);
            if (items.length) return jsonResponse({ success: true, page, data: items });
          } catch (e) { /* try next */ }
        }
        // Final fallback: use the homepage latest grid
        const data = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
        return jsonResponse({ success: true, page: 1, data: extractAnimeList(data).slice(0, 30) });
      }

      // ====================================================================
      // Popular charts
      // ====================================================================
      if (path === "/api/popular") {
        const type = params.get("type");
        const data = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
        let results = extractPopularItems(data, type);
        if (results.length === 0) {
          results = extractAnimeList(data).slice(0, 25).map((r, i) => ({ rank: i + 1, ...r }));
        }
        return jsonResponse({ success: true, data: results });
      }

      if (path === "/api/popular/films") {
        const data = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
        let results = extractPopularItems(data, "movie");
        // Also include items where URL has /movies/
        results = results.map(item => ({
          ...item,
          type: item.url && item.url.includes("/movies/") ? "movie" : item.type
        })).filter(i => i.type === "movie");

        if (results.length === 0) {
          results = extractAnimeList(data)
            .filter(item => item.url && item.url.includes("/movies/"))
            .slice(0, 20)
            .map((r, i) => ({ rank: i + 1, ...r, type: "movie" }));
        }
        return jsonResponse({ success: true, data: results });
      }

      if (path === "/api/popular/series") {
        const data = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
        let results = extractPopularItems(data, "series");
        if (results.length === 0) {
          results = extractAnimeList(data)
            .filter(item => item.type === "series")
            .slice(0, 20)
            .map((r, i) => ({ rank: i + 1, ...r }));
        }
        return jsonResponse({ success: true, data: results });
      }

      // ====================================================================
      // Status categories
      // ====================================================================
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

      // ====================================================================
      // Type / genre categories
      // ====================================================================
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
        const prefixes = [
          `/category/genre/${category}/`,
          `/genre/${category}/`
        ];
        for (const base of prefixes) {
          const p = page > 1 ? `${base}page/${page}/` : base;
          try {
            const data = await cachedJSON(`html:${p}`, () => fetchPage(p), CACHE_TTL_HOME);
            const items = extractAnimeList(data);
            if (items.length) return jsonResponse({ success: true, page, genre: category, data: items });
          } catch (e) { /* try next */ }
        }
        return jsonResponse({ success: true, page, genre: category, data: [] });
      }

      // ====================================================================
      // Content-type catalogs
      // ====================================================================
      if (path === "/api/series") {
        const page = parseInt(params.get("page") || "1", 10);
        const p = page > 1 ? `/category/type/series/page/${page}/` : "/category/type/series/";
        try {
          const data = await cachedJSON(`html:series:${page}`, () => fetchPage(p), CACHE_TTL_HOME);
          return jsonResponse({ success: true, page, data: extractAnimeList(data) });
        } catch (e) { return jsonResponse({ success: true, page, data: [] }); }
      }

      if (path === "/api/movies") {
        const page = parseInt(params.get("page") || "1", 10);
        const prefixes = [
          "/category/type/movies/",
          "/movies/",
          "/type/movie/",
          "/format/movie/",
          "/category/type/movie/"
        ];
        for (const base of prefixes) {
          const p = page > 1 ? `${base}page/${page}/` : base;
          try {
            const data = await cachedJSON(`html:movies-path:${base}:${page}`, () => fetchPage(p), CACHE_TTL_HOME);
            const items = extractAnimeList(data);
            if (items.length) return jsonResponse({ success: true, page, data: items });
          } catch (e) { /* try next */ }
        }
        return jsonResponse({ success: true, page, data: [] });
      }

      if (path === "/api/anime") {
        const page = parseInt(params.get("page") || "1", 10);
        const prefixes = [
          "/category/genre/anime/",
          "/genre/anime/",
          "/category/type/anime/",
          "/type/anime/",
          "/anime/"
        ];
        for (const base of prefixes) {
          const p = page > 1 ? `${base}page/${page}/` : base;
          try {
            const data = await cachedJSON(`html:anime-path:${base}:${page}`, () => fetchPage(p), CACHE_TTL_HOME);
            const items = extractAnimeList(data);
            if (items.length) return jsonResponse({ success: true, page, data: items });
          } catch (e) { /* try next */ }
        }
        return jsonResponse({ success: true, page, data: [] });
      }

      if (path === "/api/cartoon") {
        const page = parseInt(params.get("page") || "1", 10);
        const prefixes = [
          "/category/genre/cartoon/",
          "/genre/cartoon/",
          "/category/type/cartoon/",
          "/type/cartoon/",
          "/cartoon/"
        ];
        for (const base of prefixes) {
          const p = page > 1 ? `${base}page/${page}/` : base;
          try {
            const data = await cachedJSON(`html:cartoon-path:${base}:${page}`, () => fetchPage(p), CACHE_TTL_HOME);
            const items = extractAnimeList(data);
            if (items.length) return jsonResponse({ success: true, page, data: items });
          } catch (e) { /* try next */ }
        }
        return jsonResponse({ success: true, page, data: [] });
      }

      // ====================================================================
      // Taxonomy lists — FIXED: try multiple pages to find nav links
      // ====================================================================
      if (path === "/api/genres" || path === "/api/languages" || path === "/api/countries" || path === "/api/discover") {
        // Try multiple pages since homepage might not have all nav links in HTML
        const pagesToTry = [
          "/",
          "/category/type/series/",
          "/series/",
          "/category/genre/action/",
          "/genre/action/"
        ];

        let html = "";
        let genres = [];
        let languages = [];
        let countries = [];

        for (const p of pagesToTry) {
          try {
            html = await cachedJSON(`html:${p}`, () => fetchPage(p), CACHE_TTL_HOME);
            genres = extractTaxonomy(html, "genre");
            languages = extractTaxonomy(html, "language");
            countries = extractTaxonomy(html, "country");

            // Break as soon as we find at least genres
            if (genres.length > 0) break;
          } catch (e) { /* try next page */ }
        }

        if (path === "/api/genres") return jsonResponse({ success: true, data: genres });
        if (path === "/api/languages") return jsonResponse({ success: true, data: languages });
        if (path === "/api/countries") return jsonResponse({ success: true, data: countries });

        return jsonResponse({
          success: true,
          data: {
            genres,
            languages,
            countries,
            types: ["series", "movies", "anime", "cartoon"],
            statuses: ["ongoing", "completed"],
          },
        });
      }

      // ====================================================================
      // Generic taxonomy passthrough: /api/category/<tax>/<term>?page=N
      // ====================================================================
      if (path.startsWith("/api/category/")) {
        const parts = path.split("/").filter(Boolean);
        const tax = parts[2];
        const term = parts[3];
        if (!tax || !term) return jsonResponse({ success: false, error: "Usage: /api/category/<taxonomy>/<term>" }, 400);
        return await categoryPage(`/api/category/x/${term}`, tax, params, [`/${tax}/`]);
      }

      // ====================================================================
      // Named taxonomy routes
      // ====================================================================
      if (path.startsWith("/api/country/"))  return await categoryPage(path, "country", params, ["/country/"]);
      if (path.startsWith("/api/language/")) return await categoryPage(path, "language", params, ["/language/"]);
      if (path.startsWith("/api/quality/"))  return await categoryPage(path, "quality", params, ["/quality/"]);
      if (path.startsWith("/api/season/"))   return await categoryPage(path, "season", params, ["/season/", "/category/season/"]);
      if (path.startsWith("/api/studio/"))   return await categoryPage(path, "studio", params, ["/studio/"]);
      if (path.startsWith("/api/year/"))     return await categoryPage(path, "year", params, ["/release-year/", "/year/", "/category/year/"]);

      // ====================================================================
      // Random pick
      // ====================================================================
      if (path === "/api/random") {
        const page = 1 + Math.floor(Math.random() * 10);
        const p = `/category/type/series/page/${page}/`;
        try {
          const data = await cachedJSON(`html:${p}`, () => fetchPage(p), CACHE_TTL_HOME);
          const items = extractAnimeList(data);
          if (!items.length) return jsonResponse({ success: false, error: "Empty page" }, 404);
          return jsonResponse({ success: true, data: items[Math.floor(Math.random() * items.length)] });
        } catch (e) { return jsonResponse({ success: false, error: e.message }, 500); }
      }

      // ====================================================================
      // Anime details
      // ====================================================================
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

      // ====================================================================
      // Episodes (parallel season AJAX)
      // ====================================================================
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

      // ====================================================================
      // Servers
      // ====================================================================
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

      // ====================================================================
      // Stream resolver
      // ====================================================================
      if (path === "/api/stream") {
        const epSlug = params.get("ep");
        const serverParam = params.get("server") || "0";
        const lang = params.get("lang");
        const audio = params.get("audio");
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
                  if (m) { embedUrl = m.link; selectedLanguage = m.language; }
                } else {
                  const eng = languages.find(l => l.language?.toLowerCase().includes("eng"));
                  if (eng) { embedUrl = eng.link; selectedLanguage = eng.language; }
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

          let groups = { audio: [], subtitles: [] };
          if (resolvedStream.direct_hls) groups = await getMasterInfo(resolvedStream.direct_hls);

          let proxied = primary ? proxyMediaUrl(workerOrigin, primary) : null;
          if (proxied && audio) proxied += `&audio=${encodeURIComponent(audio)}`;

          const subtitles = (resolvedStream.subtitles || []).map(s => ({
            label: s.label,
            url: proxyMediaUrl(workerOrigin, s.url) +
                 "&force=" + encodeURIComponent("text/vtt") +
                 (s.referer ? "&referer=" + encodeURIComponent(s.referer) : ""),
          }));

          return jsonResponse({
            success: true,
            data: {
              ...resolvedStream,
              subtitles,
              proxied_url: proxied,
              audio_languages: groups.audio,
              subtitle_languages: groups.subtitles,
              selected_audio: audio || null,
              serverIndex,
              selectedLanguage,
              isIframe: false,
              referer: resolvedStream.host === "as-cdn26.top" ? "https://as-cdn26.top/" : "https://abyssplayer.com/",
            },
          });
        }
        return jsonResponse({ success: true, data: { embedUrl, serverIndex, selectedLanguage, isIframe: true, referer: `${BASE_URL}/episode/${epSlug}/` } });
      }

      // ====================================================================
      // Raw WordPress AJAX passthrough
      // ====================================================================
      if (path === "/api/ajax") {
        const action = params.get("action");
        if (!action) return jsonResponse({ success: false, error: "action required" }, 400);
        const passthrough = {};
        for (const [k, v] of params.entries()) passthrough[k] = v;
        const frag = await siteAjax(passthrough);
        return new Response(frag, { headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders } });
      }

      // ====================================================================
      // Media proxy (CORS + manifest rewrite + SRT→VTT)
      // ====================================================================
      if (path === "/proxy/media") {
        return await handleMediaProxy(request);
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (e) {
      return jsonResponse({ error: e.message, stack: e.stack }, 500);
    }
  }
};