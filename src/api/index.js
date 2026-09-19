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

function isContentPage(html) {
  if (!html) return false;
  if (/<title>[^<]*404/i.test(html)) return false;
  if (/>\s*404\s+Not\s+Found\s*</i.test(html)) return false;
  return /entry-title|server-btn|<iframe|overview-text/i.test(html);
}

const BAD_IMAGE = /cropped-|icon\.png|logo\.png|favicon|AnimeSalticon/i;
const LANDSCAPE_TMDB = /image\.tmdb\.org\/t\/p\/w(?:780|1280|1920|original)\//i;
const PORTRAIT_TMDB = /image\.tmdb\.org\/t\/p\/w(?:500|342|185|154)\//i;
const SITE_ASSET = /animesalt\.cx\/wp-content\/uploads|AnimeSalt|cropped-|icon\.png|logo\.png|favicon/i;
const TMDB_HOST = "https://image.tmdb.org";
const CACHE_TTL_STATUS = 6 * 60 * 60 * 1000;

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
          version: "3.29.0",
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
          version: "3.29.0-edge",
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
      // HOME — simple shape (no nested payload cache)
      // ====================================================================
      if (path === "/api/home") {
        const raw = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
        const homeData = raw
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ");

        const secs = extractHomeSections(homeData);
        const mostWatchedSeries = secs["Most-Watched Series"] || [];
        const mostWatchedFilms = secs["Most-Watched Films"] || [];

        const [ongoing, completed, movies, freshDrops] = await Promise.all([
          (async () => {
            try { return extractAnimeList(await fetchPage("/category/status/ongoing/")).slice(0, 18); } catch (e) { return []; }
          })(),
          (async () => {
            try { return extractAnimeList(await fetchPage("/category/status/completed/")).slice(0, 18); } catch (e) { return []; }
          })(),
          (async () => {
            for (const p of ["/movies/", "/category/type/movies/"]) {
              try { const items = extractAnimeList(await fetchPage(p)); if (items.length) return items.slice(0, 18); } catch (e) { /* next */ }
            }
            return [];
          })(),
          (async () => {
            for (const base of ["/new/", "/recent/", "/latest/"]) {
              try { const items = extractAnimeList(await fetchPage(base)); if (items.length) return items.slice(0, 18); } catch (e) { /* next */ }
            }
            return [];
          })(),
        ]);

        const latestEpisodes = extractAnimeList(homeData).slice(0, 20);

        return jsonResponse({
          success: true,
          data: {
            mostWatchedSeries, mostWatchedFilms, latest: latestEpisodes,
            ongoing, completed, movies, freshDrops,
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
      // DEBUG: poster/backdrop forensics
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
        const after = html.slice(titleIdx > -1 ? titleIdx : 0);

        const dataAttrs = [...html.matchAll(/\bdata-[a-z-]+="[^"]*"/gi)].map(m => m[0]).slice(0, 20);
        const cdnRefs = [...html.matchAll(/https?:\/\/[^"'\s<>]+/gi)]
          .map(m => m[0])
          .filter(u => u.includes("img.animesalt") || u.includes("tmdb"))
          .slice(0, 10);

        const imgs = [...before.matchAll(/<img[^>]*>/gi)].map(m => m[0]).slice(-6);
        const imgsAfter = [...after.matchAll(/<img[^>]*>/gi)].map(m => m[0]).slice(0, 8);
        const metas = [...html.matchAll(/<meta[^>]*(?:og:image|twitter:image)[^>]*>/gi)].map(m => m[0]);
        const bgImages = [...before.matchAll(/background(?:-image)?:\s*url\([^)]*\)/gi)].map(m => m[0]).slice(-4);
        const backdropHints = [...html.matchAll(/.{0,60}backdrop.{0,100}/gi)].map(m => m[0]).slice(0, 6);

        return jsonResponse({
          success: true,
          data: {
            imgsBeforeTitle: imgs,
            imgsAfterTitle: imgsAfter,
            metas,
            bgBeforeTitle: bgImages,
            backdropHints,
            dataAttributes: dataAttrs,
            cdnReferences: cdnRefs
          },
        });
      }

      if (path === "/api/latest-episodes") {
        const items = await cachedJSON("list:latest:v2", async () => {
          const raw = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
          return extractAnimeList(raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")).slice(0, 20);
        }, CACHE_TTL_HOME);
        return jsonResponse({ success: true, data: items });
      }

      // ====================================================================
      // Fresh Drops
      // ====================================================================
      if (path === "/api/fresh-drops") {
        const page = parseInt(params.get("page") || "1", 10);
        const prefixes = [
          "/category/status/fresh-drops/", "/new/", "/recent/", "/latest/", "/category/status/recently-added/"
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
      if (path === "/api/popular" || path === "/api/popular/films" || path === "/api/popular/series") {
        const charts = await cachedJSON("charts:payload:v2", async () => {
          const raw = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
          const slim = raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
          const secs = extractHomeSections(slim);
          return {
            series: secs["Most-Watched Series"] || [],
            films: secs["Most-Watched Films"] || [],
            all: extractAnimeList(slim).slice(0, 25),
          };
        }, CACHE_TTL_HOME);

        if (path === "/api/popular/films") {
          let results = charts.films;
          if (!results.length) results = charts.all.filter(i => i.url && i.url.includes("/movies/")).map((r, i) => ({ rank: i + 1, ...r, type: "movie" }));
          return jsonResponse({ success: true, data: results });
        }
        if (path === "/api/popular/series") {
          let results = charts.series;
          if (!results.length) results = charts.all.filter(i => i.type === "series").map((r, i) => ({ rank: i + 1, ...r }));
          return jsonResponse({ success: true, data: results });
        }
        const type = params.get("type");
        let results = type === "movie" ? charts.films : type === "series" ? charts.series : [...charts.series, ...charts.films];
        if (!results.length) results = charts.all;
        results = results.map((item, i) => ({
          rank: item.rank ?? i + 1,
          ...item,
          type: item.url && item.url.includes("/movies/") ? "movie" : (item.type || "series"),
        }));
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
          "/category/type/movies/", "/movies/", "/type/movie/", "/format/movie/", "/category/type/movie/"
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
          "/category/genre/anime/", "/genre/anime/", "/category/type/anime/", "/type/anime/", "/anime/"
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
          "/category/genre/cartoon/", "/genre/cartoon/", "/category/type/cartoon/", "/type/cartoon/", "/cartoon/"
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
          data: { genres, languages, countries, types: ["series", "movies", "anime", "cartoon"], statuses: ["ongoing", "completed"] },
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
      // Anime / movie details
      // ====================================================================
      if (path === "/api/info") {
        const animeId = params.get("id") || params.get("slug");
        if (!animeId) return jsonResponse({ success: false, error: "Anime ID (slug) is required" }, 400);

        let data = "";
        let type = "series";

        try {
          const seriesHtml = await cachedJSON(`html:series:${animeId}`, () => fetchPage(`/series/${animeId}/`), CACHE_TTL_HOME);
          if (isContentPage(seriesHtml)) { data = seriesHtml; type = "series"; }
        } catch (e) { /* fall through */ }

        if (!data) {
          try {
            const movieHtml = await cachedJSON(`html:movies:${animeId}`, () => fetchPage(`/movies/${animeId}/`), CACHE_TTL_HOME);
            if (isContentPage(movieHtml)) { data = movieHtml; type = "movies"; }
          } catch (e) { /* both missing */ }
        }

        if (!data) {
          return jsonResponse({ success: false, error: "Content not found" }, 404);
        }

        const titleMatch = data.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
                        || data.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : "Unknown";

        const titleIdx = data.search(/<h1/i);
        const beforeTitle = data.slice(0, titleIdx > -1 ? titleIdx : 20000);
        const imgsBefore = [...beforeTitle.matchAll(/<img[^>]*>/gi)];

        // ---------------- POSTER (portrait) ----------------
        let poster = "";
        for (let i = imgsBefore.length - 1; i >= 0 && !poster; i--) {
          const tag = imgsBefore[i][0];
          const srcM = tag.match(/\b(?:data-lazy-src|data-original|data-src|data-cfsrc|src)="([^"]+)"/i);
          if (!srcM) continue;
          const url = srcM[1];
          if (url.startsWith("data:")) continue;
          if (BAD_IMAGE.test(url)) continue;
          if (LANDSCAPE_TMDB.test(url)) continue;
          if (SITE_ASSET.test(url)) continue;
          poster = url;
        }
        if (!poster) {
          const bgs = [...beforeTitle.matchAll(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/gi)];
          for (let i = bgs.length - 1; i >= 0 && !poster; i--) {
            const url = bgs[i][1];
            if (url.startsWith("data:") || BAD_IMAGE.test(url) || SITE_ASSET.test(url)) continue;
            if (LANDSCAPE_TMDB.test(url)) continue;
            poster = url;
          }
        }
        if (!poster) {
          const ogMatch = data.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
          if (ogMatch && !ogMatch[1].startsWith("data:") && !BAD_IMAGE.test(ogMatch[1]) && !LANDSCAPE_TMDB.test(ogMatch[1]) && !SITE_ASSET.test(ogMatch[1])) {
            poster = ogMatch[1];
          }
        }
        if (!poster) {
          const t = data.match(/https:\/\/image\.tmdb\.org\/t\/p\/w(?:500|342|185|154)\/[^"'\s<>]+/);
          if (t) poster = t[0];
        }
        if (poster.startsWith("//")) poster = "https:" + poster;

        // ---------------- BACKDROP (landscape ONLY) ----------------
        let backdrop = "";
        const unescaped = data.replace(/\\\//g, "/");

        const urlInStyles = [...unescaped.matchAll(/url\(\s*['"]?(https?:\/\/[^'")]+|\/\/[^'")]+)['"]?\s*\)/gi)].map(m => m[1]);
        const srcsetUrls = [...unescaped.matchAll(/\bsrcset="([^"]+)"/gi)].map(m => m[1].split(/[ ,]/)[0]);
        const preloadUrls = [...unescaped.matchAll(/<link[^>]*rel="preload"[^>]*as="image"[^>]*href="([^"]+)"/gi)].map(m => m[1]);
        const bgCandidates = [...urlInStyles, ...srcsetUrls, ...preloadUrls]
          .filter(u => u && !u.startsWith("data:") && !SITE_ASSET.test(u) && !BAD_IMAGE.test(u))
          .map(u => (u.startsWith("//") ? "https:" + u : u));
        backdrop = bgCandidates.find(u => LANDSCAPE_TMDB.test(u)) || "";

        if (!backdrop) {
          const lm = unescaped.match(/https:\/\/image\.tmdb\.org\/t\/p\/w(?:1280|780|1920|original)\/[^"'\s<>\\)]+/);
          if (lm) backdrop = lm[0];
        }

        if (!backdrop) {
          const pm = unescaped.match(/["']?(?:backdrop_path|backdropPath|backdrop)["']?\s*[:=]\s*["'](\/?[a-zA-Z0-9\/._-]+\.(?:jpe?g|png|webp)|\/[a-zA-Z0-9\/._-]+)["']/i);
          if (pm) {
            let p = pm[1];
            if (!p.startsWith("/")) p = "/" + p;
            backdrop = `${TMDB_HOST}/t/p/w1280${p}`;
          }
        }

        if (!backdrop) {
          const fm = unescaped.match(/["'](\/t\/p\/w(?:1280|780|1920|original)\/[^"']+)["']/);
          if (fm) backdrop = TMDB_HOST + fm[1];
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

        // Tag-stripped visible text
        const textOnly = data
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z#0-9]+;/gi, " ");

        // ---------------- QUICK PLAY + RUNTIME ----------------
        const sxe = (s, e) => ({ season: parseInt(s, 10), episode: parseInt(e, 10), slug: `${animeId}-${s}x${e}` });
        let firstEp = null, latestDub = null, latestSub = null;
        const mFirst = textOnly.match(/First\s*S(\d+)\s*E(\d+)/i);
        const mDub   = textOnly.match(/Latest\s*Dub\s*S(\d+)\s*E(\d+)/i);
        const mSub   = textOnly.match(/Latest\s*Sub\s*S(\d+)\s*E(\d+)/i);
        if (mFirst) firstEp = sxe(mFirst[1], mFirst[2]);
        if (mDub)   latestDub = sxe(mDub[1], mDub[2]);
        if (mSub)   latestSub = sxe(mSub[1], mSub[2]);
        const runtimeMatch = textOnly.match(/(\d+)\s*min\b/i);
        const runtime = runtimeMatch ? parseInt(runtimeMatch[1], 10) : null;

        // Year
        let year = null;
        const runtimeYear = textOnly.match(/(?:\d+\s*h(?:rs?)?(?:\s*\d+\s*m(?:in)?)?|\d+\s*m(?:in)?)\s*((?:19|20)\d{2})\b/i);
        if (runtimeYear) year = parseInt(runtimeYear[1]);
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
            .map(m => parseInt(m[1])).filter(y => y >= 1950 && y <= 2024);
          if (years.length) year = Math.min(...years);
        }

        // ---------------- STATUS (3-source resolution) ----------------
        let status = type === "movies" ? "Released" : "Unknown";
        if (type === "series") {
          const label = textOnly.match(/Status\s*[:\-]\s*(Ongoing|Completed|Airing|Finished|Ended)/i);
          if (label) {
            status = /Ongoing|Airing/i.test(label[1]) ? "Ongoing" : "Completed";
          } else {
            try {
              const homeHtml = await cachedJSON("html:home", () => fetchPage("/"), CACHE_TTL_HOME);
              if (extractAnimeList(homeHtml).some(i => i.id === animeId)) status = "Ongoing";
            } catch (e) {}

            if (status === "Unknown") {
              for (let pg = 1; pg <= 10 && status === "Unknown"; pg++) {
                try {
                  const p = pg > 1 ? `/category/status/ongoing/page/${pg}/` : "/category/status/ongoing/";
                  const h = await cachedJSON(`html:status-ongoing:${pg}`, () => fetchPage(p), CACHE_TTL_STATUS);
                  if (extractAnimeList(h).some(i => i.id === animeId)) status = "Ongoing";
                } catch (e) { break; }
              }
            }

            if (status === "Unknown") {
              for (let pg = 1; pg <= 10 && status === "Unknown"; pg++) {
                try {
                  const p = pg > 1 ? `/category/status/completed/page/${pg}/` : "/category/status/completed/";
                  const h = await cachedJSON(`html:status-completed:${pg}`, () => fetchPage(p), CACHE_TTL_STATUS);
                  if (extractAnimeList(h).some(i => i.id === animeId)) status = "Completed";
                } catch (e) { break; }
              }
            }
          }
        }

        // ---------------- SEASONS / EPISODES ----------------
        let seasons = [], totalEpisodes = 0;
        if (type === "series") {
          try {
            const epData = await getEpisodesData(animeId, "all");
            seasons = epData.seasons || [];

            if (seasons.length > 0) {
              totalEpisodes = seasons.reduce((sum, s) => {
                const countMatch = s.title.match(/\((\d+)\)/);
                return sum + (countMatch ? parseInt(countMatch[1], 10) : 0);
              }, 0);
            } else {
              totalEpisodes = (epData.episodes || []).length;
            }

            if (status === "Unknown" && totalEpisodes >= 100) {
              status = "Ongoing";
            }
          } catch (e) {
            console.error(`Episodes fetch failed for ${animeId}:`, e.message);
          }

          if (!totalEpisodes) {
            const epChip = textOnly.match(/(\d+)\s*Episodes/i);
            if (epChip) totalEpisodes = parseInt(epChip[1], 10);
          }

          if (!seasons.length) {
            const sChip = textOnly.match(/(\d+)\s*Seasons/i);
            if (sChip) {
              const n = parseInt(sChip[1], 10);
              seasons = Array.from({ length: n }, (_, i) => ({
                num: i + 1, title: `Season ${i + 1}`, value: String(i + 1)
              }));
            }
          }

          if (status === "Unknown" && totalEpisodes >= 100) {
            status = "Ongoing";
          }
        } else {
          totalEpisodes = 1;
        }

        return jsonResponse({
          success: true,
          data: {
            id: animeId, title, poster, backdrop, description, type,
            totalEpisodes, year, status, seasons, genres, languages,
            runtime,
            quickPlay: { first: firstEp, latestDub: latestDub, latestSub: latestSub }
          }
        });
      }

      // ====================================================================
      // Episodes
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
          const ep = { num: 1, season: 1, title, slug: animeId, url: `${BASE_URL}/movies/${animeId}/`, image: image || null };
          return jsonResponse({
            success: true,
            data: {
              animeId, requestedSeason, availableSeasons: [1], totalEpisodes: 1, failedSeasons: [],
              groupedEpisodes: { "1": [ep] }, isMovie: true,
            },
          });
        }

        const groupedEpisodes = {};
        for (const ep of episodes) {
          if (!groupedEpisodes[ep.season]) groupedEpisodes[ep.season] = [];
          groupedEpisodes[ep.season].push(ep);
        }

        return jsonResponse({
          success: true,
          data: { animeId, requestedSeason, availableSeasons: seasons.map(s => s.num), totalEpisodes: episodes.length, failedSeasons, groupedEpisodes }
        });
      }

      // ====================================================================
      // Servers
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
      // Stream resolver
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
              ...resolvedStream, subtitles, proxied_url: proxied,
              audio_languages: groups.audio, subtitle_languages: groups.subtitles,
              selected_audio: audio || null, serverIndex, selectedLanguage,
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