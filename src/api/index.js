import { jsonResponse, corsHeaders, BASE_URL, CACHE_TTL_HOME, CACHE_TTL, CHROME_HEADERS } from "./config.js";
import { cachedJSON, fetchPage, siteAjax } from "./net.js";
import { extractAnimeList, extractPopularItems, extractEmbedForIndex, extractTaxonomy, extractHomeSections } from "./parsers.js";
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

// Movies embed their player on /movies/<slug>/, series on /series/<slug>/,
// episodes on /episode/<slug>/. Try all three for playback markup.
async function getPlaybackHtml(slug) {
  const candidates = [`/episode/${slug}/`, `/movies/${slug}/`, `/series/${slug}/`];
  for (const p of candidates) {
    try {
      const html = await cachedJSON(`html:playback:${p}`, () => fetchPage(p), CACHE_TTL_HOME);
      if (html && /server-btn|<iframe/i.test(html)) return html;
    } catch (e) { /* try next */ }
  }
  return "";
}

// Reject 404/error pages; require at least one real-content marker
function isContentPage(html) {
  if (!html) return false;
  if (/<title>[^<]*404/i.test(html)) return false;
  if (/>\s*404\s+Not\s+Found\s*</i.test(html)) return false;
  return /entry-title|server-btn|<iframe|overview-text/i.test(html);
}

const BAD_IMAGE = /cropped-|icon\.png|logo\.png|favicon|AnimeSalticon/i;
// Landscape TMDB profiles = backdrops / episode stills, never posters
const LANDSCAPE_TMDB = /image\.tmdb\.org\/t\/p\/w(?:780|1280|1920|original)\//i;
const PORTRAIT_TMDB = /image\.tmdb\.org\/t\/p\/w(?:500|342|185|154)\//i;

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
          version: "3.19.0",
          endpoints: {
            system: ["/api/health", "/api/ajax", "/proxy/media", "/api/debug/home-headings", "/api/debug/poster"],
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
          version: "3.19.0-edge",
          endpointsCount: 31
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
      // HOME
      // ====================================================================
      if (path === "/api/home") {
        const homeData = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
        const secs = extractHomeSections(homeData);

        const mostWatchedSeries = secs["Most-Watched Series"] || [];
        const mostWatchedFilms = secs["Most-Watched Films"] || [];

        const [latestEpisodes, ongoing, completed, movies, freshDrops] = await Promise.all([
          Promise.resolve(extractAnimeList(homeData).slice(0, 20)),
          cachedJSON("html:/category/status/ongoing/", () => fetchPage("/category/status/ongoing/"), CACHE_TTL_HOME)
            .then(h => extractAnimeList(h).slice(0, 18)).catch(() => []),
          cachedJSON("html:/category/status/completed/", () => fetchPage("/category/status/completed/"), CACHE_TTL_HOME)
            .then(h => extractAnimeList(h).slice(0, 18)).catch(() => []),
          (async () => {
            for (const p of ["/movies/", "/category/type/movies/"]) {
              try {
                const h = await fetchPage(p);
                const items = extractAnimeList(h);
                if (items.length) return items.slice(0, 18);
              } catch (e) { /* next */ }
            }
            return [];
          })(),
          (async () => {
            for (const base of ["/new/", "/recent/", "/latest/"]) {
              try {
                const h = await fetchPage(base);
                const items = extractAnimeList(h);
                if (items.length) return items.slice(0, 18);
              } catch (e) { /* next */ }
            }
            return [];
          })(),
        ]);

        return jsonResponse({
          success: true,
          data: {
            mostWatchedSeries,
            mostWatchedFilms,
            latest: latestEpisodes,
            ongoing,
            completed,
            movies,
            freshDrops,
            popular: [...mostWatchedSeries.slice(0, 12), ...mostWatchedFilms.slice(0, 12)],
            popularSeries: mostWatchedSeries.slice(0, 12),
            popularFilms: mostWatchedFilms.slice(0, 12),
          },
        });
      }

      // ====================================================================
      // DEBUG: homepage headings
      // ====================================================================
      if (path === "/api/debug/home-headings") {
        const html = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
        const headings = [];
        const regex = /<(h[1-6]|div|span)[^>]*class="[^"]*(?:title|heading|section|widget)[^"]*"[^>]*>([^<]+)<\/\1>/gi;
        let match;
        while ((match = regex.exec(html)) !== null) {
          const text = (match[2] || '').trim();
          if (text.length > 3 && text.length < 80) headings.push(text);
        }
        const plainRegex = /<h[1-6][^>]*>([^<]+)<\/h[1-6]>/gi;
        while ((match = plainRegex.exec(html)) !== null) {
          const text = (match[1] || '').trim();
          if (text.length > 3 && text.length < 80) headings.push(text);
        }
        return jsonResponse({ success: true, data: [...new Set(headings)].slice(0, 50) });
      }

      // ====================================================================
      // DEBUG: verbatim poster/backdrop markup before the title
      // ====================================================================
      if (path === "/api/debug/poster") {
        const id = params.get("id");
        if (!id) return jsonResponse({ success: false, error: "id required" }, 400);
        let html = "";
        try { html = await fetchPage(`/series/${id}/`); } catch (e) {}
        if (!isContentPage(html)) {
          try { html = await fetchPage(`/movies/${id}/`); } catch (e) {}
        }
        if (!html) return jsonResponse({ success: false, error: "not found" }, 404);
        const titleIdx = html.search(/<h1/i);
        const before = html.slice(0, titleIdx > -1 ? titleIdx : 20000);
        const imgs = [...before.matchAll(/<img[^>]*>/gi)].map(m => m[0]).slice(-6);
        const metas = [...html.matchAll(/<meta[^>]*(?:og:image|twitter:image)[^>]*>/gi)].map(m => m[0]);
        const bgImages = [...before.matchAll(/background-image:\s*url\([^)]*\)/gi)].map(m => m[0]).slice(-4);
        return jsonResponse({ success: true, data: { imgsBeforeTitle: imgs, metas, bgBeforeTitle: bgImages } });
      }

      if (path === "/api/latest-episodes") {
        const data = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
        return jsonResponse({ success: true, data: extractAnimeList(data).slice(0, 20) });
      }

      // ====================================================================
      // Fresh Drops
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
        results = results.map(item => ({
          ...item,
          type: item.url && item.url.includes("/movies/") ? "movie" : (item.type || "series"),
        }));
        return jsonResponse({ success: true, data: results });
      }

      if (path === "/api/popular/films") {
        const homeData = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
        const secs = extractHomeSections(homeData);
        let results = secs["Most-Watched Films"] || [];
        if (!results.length) results = extractPopularItems(homeData, "movie");
        if (!results.length) {
          results = extractAnimeList(homeData)
            .filter(item => item.url && item.url.includes("/movies/"))
            .slice(0, 20)
            .map((r, i) => ({ rank: i + 1, ...r, type: "movie" }));
        }
        return jsonResponse({ success: true, data: results });
      }

      if (path === "/api/popular/series") {
        const homeData = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
        const secs = extractHomeSections(homeData);
        let results = secs["Most-Watched Series"] || [];
        if (!results.length) results = extractPopularItems(homeData, "series");
        if (!results.length) {
          results = extractAnimeList(homeData)
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
        const prefixes = [`/category/genre/${category}/`, `/genre/${category}/`];
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
      // Taxonomy lists
      // ====================================================================
      if (path === "/api/genres" || path === "/api/languages" || path === "/api/countries" || path === "/api/discover") {
        const pagesToTry = ["/", "/category/type/series/", "/series/", "/category/genre/action/", "/genre/action/"];
        let genres = [], languages = [], countries = [];
        for (const p of pagesToTry) {
          try {
            const html = await cachedJSON(`html:${p}`, () => fetchPage(p), CACHE_TTL_HOME);
            genres = extractTaxonomy(html, "genre");
            languages = extractTaxonomy(html, "language");
            countries = extractTaxonomy(html, "country");
            if (genres.length > 0) break;
          } catch (e) { /* try next page */ }
        }
        if (path === "/api/genres") return jsonResponse({ success: true, data: genres });
        if (path === "/api/languages") return jsonResponse({ success: true, data: languages });
        if (path === "/api/countries") return jsonResponse({ success: true, data: countries });
        return jsonResponse({
          success: true,
          data: {
            genres, languages, countries,
            types: ["series", "movies", "anime", "cartoon"],
            statuses: ["ongoing", "completed"],
          },
        });
      }

      // ====================================================================
      // Generic taxonomy passthrough
      // ====================================================================
      if (path.startsWith("/api/category/")) {
        const parts = path.split("/").filter(Boolean);
        const tax = parts[2];
        const term = parts[3];
        if (!tax || !term) return jsonResponse({ success: false, error: "Usage: /api/category/<taxonomy>/<term>" }, 400);
        return await categoryPage(`/api/category/x/${term}`, tax, params, [`/${tax}/`]);
      }

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
      // Anime / movie details — v3.19.0
      // poster  = last portrait img right before <h1>
      // backdrop = landscape artwork (bg-image or landscape img) before <h1>
      // year    = runtime-adjacent year in visible text
      // ====================================================================
      if (path === "/api/info") {
        const animeId = params.get("id") || params.get("slug");
        if (!animeId) return jsonResponse({ success: false, error: "Anime ID (slug) is required" }, 400);

        let data = "";
        let type = "series";

        try {
          const seriesHtml = await cachedJSON(`html:series:${animeId}`, () => fetchPage(`/series/${animeId}/`), CACHE_TTL_HOME);
          if (isContentPage(seriesHtml)) {
            data = seriesHtml;
            type = "series";
          }
        } catch (e) { /* fall through */ }

        if (!data) {
          try {
            const movieHtml = await cachedJSON(`html:movies:${animeId}`, () => fetchPage(`/movies/${animeId}/`), CACHE_TTL_HOME);
            if (isContentPage(movieHtml)) {
              data = movieHtml;
              type = "movies";
            }
          } catch (e) { /* both missing */ }
        }

        if (!data) {
          return jsonResponse({ success: false, error: "Content not found" }, 404);
        }

        // Title
        const titleMatch = data.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) 
                        || data.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : "Unknown";

        // Slice of HTML before the title (hero area: backdrop + poster live here)
        const titleIdx = data.search(/<h1/i);
        const beforeTitle = data.slice(0, titleIdx > -1 ? titleIdx : 20000);

        // ---------------- POSTER ----------------
        let poster = "";
        const imgsBefore = [...beforeTitle.matchAll(/<img[^>]*>/gi)];
        for (let i = imgsBefore.length - 1; i >= 0 && !poster; i--) {
          const tag = imgsBefore[i][0];
          const srcM = tag.match(/\b(?:data-lazy-src|data-original|data-src|data-cfsrc|src)="([^"]+)"/i);
          if (!srcM) continue;
          const url = srcM[1];
          if (url.startsWith("data:")) continue;          // lazy placeholder
          if (BAD_IMAGE.test(url)) continue;              // site icon/logo
          if (LANDSCAPE_TMDB.test(url)) continue;         // backdrop / still
          poster = url;
        }
        // Fallback: background-image before title (portrait or any non-icon)
        if (!poster) {
          const bgs = [...beforeTitle.matchAll(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/gi)];
          for (let i = bgs.length - 1; i >= 0 && !poster; i--) {
            const url = bgs[i][1];
            if (url.startsWith("data:") || BAD_IMAGE.test(url)) continue;
            if (LANDSCAPE_TMDB.test(url)) continue;
            poster = url;
          }
        }
        // Fallback: og:image (filtered)
        if (!poster) {
          const ogMatch = data.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
          if (ogMatch && !ogMatch[1].startsWith("data:") && !BAD_IMAGE.test(ogMatch[1]) && !LANDSCAPE_TMDB.test(ogMatch[1])) {
            poster = ogMatch[1];
          }
        }
        // Last resort: first portrait TMDB url anywhere
        if (!poster) {
          const t = data.match(/https:\/\/image\.tmdb\.org\/t\/p\/w(?:500|342|185|154)\/[^"'\s<>]+/);
          if (t) poster = t[0];
        }
        if (poster.startsWith("//")) poster = "https:" + poster;

        // ---------------- BACKDROP (hero background artwork) ----------------
        let backdrop = "";
        const bgUrls = [...beforeTitle.matchAll(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/gi)]
          .map(m => m[1]);
        const landscapeImgs = imgsBefore.map(tag => {
          const srcM = tag[0].match(/\b(?:data-lazy-src|data-original|data-src|data-cfsrc|src)="([^"]+)"/i);
          return srcM ? srcM[1] : "";
        });
        const bgCandidates = [...bgUrls, ...landscapeImgs].filter(u => u && !u.startsWith("data:"));
        backdrop = bgCandidates.find(u => LANDSCAPE_TMDB.test(u)) || "";
        if (!backdrop) {
          const lm = data.match(/https:\/\/image\.tmdb\.org\/t\/p\/w(?:1280|780|1920|original)\/[^"'\s<>)]+/);
          if (lm) backdrop = lm[0];
        }
        if (!backdrop) {
          backdrop = bgCandidates.find(u => !BAD_IMAGE.test(u)) || "";
        }
        if (backdrop.startsWith("//")) backdrop = "https:" + backdrop;

        // Description
        const descMatch = data.match(/<div[^>]*id="overview-text"[^>]*>([\s\S]*?)<\/div>/i) 
                       || data.match(/<div[^>]*class="[^"]*(?:synopsis|overview|description)[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
                       || data.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
        const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : "";

        // Genres
        const genres = []; 
        const genreRegex = /href="[^"]*\/category\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/gi; 
        let match;
        while ((match = genreRegex.exec(data)) !== null) { 
          const g = match[1].trim(); 
          if (g && !genres.includes(g)) genres.push(g); 
        }

        // Languages
        const languages = []; 
        const langRegex = /href="[^"]*\/category\/language\/[^"]*"[^>]*>([^<]+)<\/a>/gi;
        while ((match = langRegex.exec(data)) !== null) { 
          const l = match[1].trim(); 
          if (l && !languages.includes(l)) languages.push(l); 
        }

        // ---------------- YEAR ----------------
        const textOnly = data
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z#0-9]+;/gi, " ");

        let year = null;
        const runtimeYear = textOnly.match(/(?:\d+\s*h(?:rs?)?(?:\s*\d+\s*m(?:in)?)?|\d+\s*m(?:in)?)\s*((?:19|20)\d{2})\b/i);
        if (runtimeYear) {
          year = parseInt(runtimeYear[1]);
        }
        if (!year) {
          const jsonLdMatch = data.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
          if (jsonLdMatch) {
            try {
              const items = JSON.parse(jsonLdMatch[1]);
              for (const item of (Array.isArray(items) ? items : [items])) {
                const d = item.datePublished || item.dateCreated || item.uploadDate;
                if (d) { const y = parseInt(d.slice(0, 4)); if (y >= 1950 && y <= 2026) { year = y; break; } }
              }
            } catch (e) {}
          }
        }
        if (!year) {
          const ym = textOnly.match(/release\s*year\s*((?:19|20)\d{2})/i);
          if (ym) year = parseInt(ym[1]);
        }
        if (!year) {
          const years = [...textOnly.matchAll(/\b((?:19|20)\d{2})\b/g)]
            .map(m => parseInt(m[1]))
            .filter(y => y >= 1950 && y <= 2024);
          if (years.length) year = Math.min(...years);
        }

        // ---------------- STATUS ----------------
        let status = type === "movies" ? "Released" : "Unknown";
        if (type === "series") {
          const statusPatterns = [
            /Status[^<]*<[^>]*>([^<]+)/i,
            /class="[^"]*status[^"]*"[^>]*>([^<]+)/i,
            /<meta[^>]*name="status"[^>]*content="([^"]+)"/i,
          ];
          for (const pattern of statusPatterns) {
            const m = data.match(pattern);
            if (m) { 
              const s = m[1] ? m[1].trim() : "";
              if (s && s.length < 50) {
                status = s;
                break;
              }
            }
          }
          if (status === "Unknown") {
            if (/Ongoing|Airing|In\s+Production/i.test(textOnly)) status = "Ongoing";
            else if (/Completed|Finished|Ended/i.test(textOnly)) status = "Completed";
          }
        }

        // ---------------- SEASONS / EPISODE COUNT ----------------
        let seasons = [], totalEpisodes = 0;
        if (type === "series") {
          try { 
            const epData = await getEpisodesData(animeId, "all"); 
            seasons = epData.seasons; 
            if (seasons.length > 0) {
              totalEpisodes = seasons.reduce((sum, s) => {
                const countMatch = s.title.match(/\((\d+)\)/);
                return sum + (countMatch ? parseInt(countMatch[1]) : 0);
              }, 0);
            } else {
              totalEpisodes = epData.episodes.length;
            }
          } catch (e) {}
          if (!totalEpisodes) {
            const epChip = textOnly.match(/(\d+)\s*Episodes/i);
            if (epChip) totalEpisodes = parseInt(epChip[1]);
          }
        } else { 
          totalEpisodes = 1; 
        }

        return jsonResponse({ 
          success: true, 
          data: { 
            id: animeId, 
            title, 
            poster, 
            backdrop,
            description, 
            type, 
            totalEpisodes, 
            year, 
            status, 
            seasons, 
            genres, 
            languages 
          } 
        });
      }

      // ====================================================================
      // Episodes — with MOVIE fallback (synthetic episode + poster as still)
      // ====================================================================
      if (path.startsWith("/api/episodes/")) {
        const animeId = path.split("/")[3];
        const seasonParam = params.get("season");
        const requestedSeason = seasonParam ? parseInt(seasonParam, 10) : "all";

        let episodes = [], seasons = [], failedSeasons = [];
        try {
          const r = await getEpisodesData(animeId, requestedSeason);
          episodes = r.episodes || [];
          seasons = r.seasons || [];
          failedSeasons = r.failedSeasons || [];
        } catch (e) { /* movie or broken series page */ }

        if (!episodes.length) {
          let title = animeId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          let image = "";
          try {
            const html = await cachedJSON(`html:movies:${animeId}`, () => fetchPage(`/movies/${animeId}/`), CACHE_TTL_HOME);
            const t = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
            if (t) title = t[1].replace(/<[^>]+>/g, "").trim();
            const stillMatch = html.match(/https:\/\/image\.tmdb\.org\/t\/p\/w(?:500|342|185|154)\/[^"'\s<>]+/);
            if (stillMatch) image = stillMatch[0];
          } catch (e) {}
          const ep = { num: 1, season: 1, title, slug: animeId, url: `${BASE_URL}/movies/${animeId}/`, image };
          return jsonResponse({
            success: true,
            data: {
              animeId,
              requestedSeason,
              availableSeasons: [1],
              totalEpisodes: 1,
              failedSeasons: [],
              groupedEpisodes: { "1": [ep] },
              isMovie: true,
            },
          });
        }

        const groupedEpisodes = {};
        for (const ep of episodes) {
          if (!groupedEpisodes[ep.season]) groupedEpisodes[ep.season] = [];
          groupedEpisodes[ep.season].push(ep);
        }

        return jsonResponse({ success: true, data: { animeId, requestedSeason, availableSeasons: seasons.map(s => s.num), totalEpisodes: episodes.length, failedSeasons, groupedEpisodes } });
      }

      // ====================================================================
      // Servers — movie-aware via getPlaybackHtml
      // ====================================================================
      if (path === "/api/servers") {
        const epSlug = params.get("ep");
        if (!epSlug) return jsonResponse({ success: false, error: "Episode slug (ep) is required" }, 400);
        const data = await getPlaybackHtml(epSlug);
        const servers = [];
        if (data) {
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
        }
        return jsonResponse({ success: true, data: servers });
      }

      // ====================================================================
      // Stream resolver — movie-aware via getPlaybackHtml
      // ====================================================================
      if (path === "/api/stream") {
        const epSlug = params.get("ep");
        const serverParam = params.get("server") || "0";
        const lang = params.get("lang");
        const audio = params.get("audio");
        if (!epSlug) return jsonResponse({ success: false, error: "Episode slug (ep) is required" }, 400);
        const data = await getPlaybackHtml(epSlug);
        const serverIndex = parseInt(serverParam, 10);

        let embedUrl = data ? extractEmbedForIndex(data, serverIndex) || null : null;
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
        return jsonResponse({ success: true, data: { embedUrl, serverIndex, selectedLanguage, isIframe: true, referer: `${BASE_URL}/movies/${epSlug}/` } });
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
      // Media proxy
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