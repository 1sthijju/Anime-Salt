// ==========================================================================
// AnimeSalt Cloudflare Worker — main entrypoint (v3.38.0)
// Modular /home, semaphore-gated concurrency, stale-while-revalidate cache
// ==========================================================================

import { resolveAsCdn26, resolveAbyss } from "./api/decryptors.js";
import { handleMediaProxy } from "./api/media-proxy.js";
import { getEpisodesData } from "./api/episodes.js";
import { CHROME_HEADERS, UPSTREAM, corsHeaders } from "./api/config.js";

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------
const CACHE_TTL = {
  hero:      60 * 60,       // 1 hour
  section:   30 * 60,       // 30 min
  catalog:   6 * 3600,      // 6 hours
  info:      30 * 60,       // 30 min
  episodes:  30 * 60,       // 30 min
  servers:   5 * 60,        // 5 min (tokens expire faster)
  taxonomy:  24 * 3600,     // 24 hours
  random:    10 * 60,       // 10 min
  health:    5 * 60,        // 5 min
  stream:    0,             // never cache (tokenized)
};

// --------------------------------------------------------------------------
// Semaphore — caps concurrent upstream fetches to avoid CPU spikes
// --------------------------------------------------------------------------
function semaphore(max) {
  let active = 0;
  const queue = [];
  return function gate(fn) {
    return new Promise((resolve, reject) => {
      const run = async () => {
        active++;
        try { resolve(await fn()); }
        catch (e) { reject(e); }
        finally {
          active--;
          if (queue.length) queue.shift()();
        }
      };
      if (active < max) run();
      else queue.push(run);
    });
  };
}
const upstreamGate = semaphore(6);  // max 6 parallel upstream fetches per request

// --------------------------------------------------------------------------
// Upstream fetch helper — timeout + retry + semaphore-gated
// --------------------------------------------------------------------------
async function fetchUpstream(path, { timeoutMs = 8000, retries = 2 } = {}) {
  const url = UPSTREAM + path;
  const headers = {
    ...CHROME_HEADERS,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const res = await upstreamGate(() =>
        fetch(url, { headers, redirect: "follow", signal: controller.signal })
      );
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr || new Error("Upstream unreachable");
}

// --------------------------------------------------------------------------
// JSON response helpers
// --------------------------------------------------------------------------
function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=60",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}
function jsonSuccess(data, extraHeaders = {}) {
  return json({ success: true, data }, 200, extraHeaders);
}
function jsonError(message, status = 500) {
  return json({ success: false, error: message }, status);
}

// --------------------------------------------------------------------------
// KV/Cache wrapper with stale-while-revalidate
// --------------------------------------------------------------------------
async function cached(key, ttlSeconds, compute, ctx) {
  const cache = caches.default;
  const url = new URL(`https://__cache/${encodeURIComponent(key)}`);
  let res = await cache.match(url);

  if (res) {
    // Return stale hit immediately; refresh in background
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(refreshInBackground(url, key, ttlSeconds, compute));
    }
    return res;
  }

  // Cache miss: compute, cache, return
  const body = await compute();
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res = new Response(payload, {
    headers: {
      "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json",
      "Cache-Control": `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 4}`,
      "Access-Control-Allow-Origin": "*",
    },
  });
  try { await cache.put(url, res.clone()); } catch { /* ignore quota errors */ }
  return res;
}

async function refreshInBackground(url, key, ttlSeconds, compute) {
  try {
    const body = await compute();
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const res = new Response(payload, {
      headers: {
        "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json",
        "Cache-Control": `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 4}`,
        "Access-Control-Allow-Origin": "*",
      },
    });
    const cache = caches.default;
    await cache.put(url, res);
  } catch (e) {
    console.error("Background refresh failed for", key, e.message);
  }
}

// --------------------------------------------------------------------------
// /api/health
// --------------------------------------------------------------------------
async function handleHealth(ctx) {
  return cached("health", CACHE_TTL.health, async () => {
    const start = Date.now();
    let online = false;
    let error = null;
    try {
      const res = await fetch(UPSTREAM + "/", { headers: CHROME_HEADERS, cf: { cacheTtl: 0 } });
      online = res.ok || res.status < 500;
    } catch (e) { error = e.message; }
    return {
      success: true,
      status: online ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      upstream: {
        source: UPSTREAM,
        online,
        latencyMs: Date.now() - start,
        error,
      },
      version: "3.38.0-modular",
      endpointsCount: 33,
    };
  }, ctx);
}

// --------------------------------------------------------------------------
// /api/home/hero — lightweight critical path
// --------------------------------------------------------------------------
async function handleHomeHero(ctx) {
  return cached("home:hero", CACHE_TTL.hero, async () => {
    const html = await fetchUpstream("/");
    const featured = parseFeatured(html).slice(0, 6);
    const ticker = parseLatest(html).slice(0, 14).map(it => ({
      title: it.title,
      sub: it.epLabel || it.sub || "new drop",
    }));
    return { featured, tickerItems: ticker };
  }, ctx);
}

// --------------------------------------------------------------------------
// /api/home/<section> — each section is independent
// --------------------------------------------------------------------------
const SECTION_FETCHERS = {
  "latest":                () => fetchCatalogSection("/latest"),
  "most-watched-series":   () => fetchCatalogSection("/most-watched/series"),
  "most-watched-films":    () => fetchCatalogSection("/most-watched/films"),
  "fresh-drops":           () => fetchCatalogSection("/fresh-drops"),
  "ongoing":               () => fetchCatalogSection("/status/ongoing"),
  "completed":             () => fetchCatalogSection("/status/completed"),
  "movies":                () => fetchCatalogSection("/movies"),
};

async function handleHomeSection(section, ctx) {
  const fetcher = SECTION_FETCHERS[section];
  if (!fetcher) return jsonError(`Unknown section: ${section}`, 404);

  const key = `home:section:${section}`;
  return cached(key, CACHE_TTL.section, async () => {
    try {
      return await fetcher();
    } catch (e) {
      // Return empty rather than 500 — client shows section-level error
      console.warn(`section ${section} failed:`, e.message);
      return [];
    }
  }, ctx);
}

async function fetchCatalogSection(path) {
  const html = await fetchUpstream(path);
  return parseCatalogItems(html);
}

// --------------------------------------------------------------------------
// /api/random — lightweight, no full-catalog scan
// --------------------------------------------------------------------------
async function handleRandom(ctx) {
  return cached("random", CACHE_TTL.random, async () => {
    // Use upstream sitemap or /random endpoint — never fetch full catalog
    try {
      const html = await fetchUpstream("/random");
      const item = parseRandomItem(html);
      if (item && item.id) return item;
    } catch {}
    // Fallback: pick from cached catalog if available
    const cache = caches.default;
    const existing = await cache.match(new URL("https://__cache/home:section:movies"));
    if (existing) {
      try {
        const j = await existing.json();
        const items = Array.isArray(j) ? j : (j && j.data) || [];
        if (items.length) return items[Math.floor(Math.random() * items.length)];
      } catch {}
    }
    throw new Error("No random source available");
  }, ctx);
}

// --------------------------------------------------------------------------
// Catalog endpoints: /api/series, /api/movies, /api/anime, /api/cartoon,
//                    /api/ongoing, /api/completed, /api/fresh-drops
// --------------------------------------------------------------------------
async function handleCatalog(kind, ctx, url) {
  const page = Number(url.searchParams.get("page") || 1);
  const key = `cat:${kind}:p${page}`;
  return cached(key, CACHE_TTL.catalog, async () => {
    try {
      const html = await fetchUpstream(`/${kind}?page=${page}`);
      return { page, data: parseCatalogItems(html) };
    } catch (e) {
      return { page, data: [], error: e.message };
    }
  }, ctx);
}

// --------------------------------------------------------------------------
// Taxonomy endpoints: /api/genre/<slug>, /api/language/<slug>, etc.
// --------------------------------------------------------------------------
const TAXONOMY_KINDS = ["genre", "language", "country", "type", "year", "network", "franchise", "status"];
async function handleTaxonomy(kind, slug, ctx, url) {
  const page = Number(url.searchParams.get("page") || 1);
  const key = `tax:${kind}:${slug}:p${page}`;
  return cached(key, CACHE_TTL.taxonomy, async () => {
    try {
      const html = await fetchUpstream(`/category/${kind}/${slug}?page=${page}`);
      return { page, [kind]: slug, data: parseCatalogItems(html) };
    } catch (e) {
      return { page, [kind]: slug, data: [], error: e.message };
    }
  }, ctx);
}

// --------------------------------------------------------------------------
// /api/search?keyword=<kw>&page=<n>
// --------------------------------------------------------------------------
async function handleSearch(ctx, url) {
  const keyword = url.searchParams.get("keyword");
  const page = Number(url.searchParams.get("page") || 1);
  if (!keyword) return jsonError("Missing keyword", 400);
  const key = `search:${keyword.toLowerCase()}:p${page}`;
  return cached(key, CACHE_TTL.catalog, async () => {
    const html = await fetchUpstream(`/?s=${encodeURIComponent(keyword)}&page=${page}`);
    return { page, data: parseCatalogItems(html) };
  }, ctx);
}

// --------------------------------------------------------------------------
// /api/info?id=<id>
// --------------------------------------------------------------------------
async function handleInfo(ctx, url) {
  const id = url.searchParams.get("id");
  if (!id) return jsonError("Missing id", 400);
  const key = `info:${id}`;
  return cached(key, CACHE_TTL.info, async () => {
    const html = await fetchUpstream(`/series/${id}/`);
    return parseInfoPage(html, id);
  }, ctx);
}

// --------------------------------------------------------------------------
// /api/episodes/<id>?season=<n|all>
// --------------------------------------------------------------------------
async function handleEpisodes(id, ctx, url) {
  const season = url.searchParams.get("season") || "all";
  const key = `eps:${id}:s${season}`;
  return cached(key, CACHE_TTL.episodes, async () => {
    const r = await getEpisodesData(id, season === "all" ? "all" : Number(season));
    return {
      animeId: id,
      requestedSeason: season === "all" ? null : Number(season),
      availableSeasons: r.seasons.map(s => s.num),
      totalEpisodes: r.episodes.length,
      failedSeasons: r.failedSeasons || [],
      groupedEpisodes: groupBySeason(r.episodes),
    };
  }, ctx);
}

// --------------------------------------------------------------------------
// /api/servers?ep=<slug>
// --------------------------------------------------------------------------
async function handleServers(ctx, url) {
  const ep = url.searchParams.get("ep");
  if (!ep) return jsonError("Missing ep", 400);
  const key = `srv:${ep}`;
  return cached(key, CACHE_TTL.servers, async () => {
    const html = await fetchUpstream(`/episode/${ep}/`);
    return parseServers(html, ep);
  }, ctx);
}

// --------------------------------------------------------------------------
// /api/stream?ep=<slug>&server=<n>&lang=<l>&audio=<a>
// --------------------------------------------------------------------------
async function handleStream(ctx, url) {
  const ep = url.searchParams.get("ep");
  const serverIdx = Number(url.searchParams.get("server") || 0);
  const lang = url.searchParams.get("lang");
  const audio = url.searchParams.get("audio");
  if (!ep) return jsonError("Missing ep", 400);

  // NEVER cache stream responses — they contain time-limited tokens
  const serversRes = await handleServers(ctx, url);
  const servers = (await serversRes.clone().json()).data || [];
  const server = servers[serverIdx];
  if (!server) return jsonError("Server not found", 404);

  const embedUrl = server.isMultiLang && lang
    ? (server.languages.find(l => l.language.toLowerCase() === lang.toLowerCase()) || {}).link
    : server.embedUrl;

  let resolved;
  if (server.isMultiLang && lang) {
    resolved = await resolveAbyss(embedUrl);
  } else if (/as-cdn/i.test(server.embedUrl)) {
    resolved = await resolveAsCdn26(server.embedUrl);
  } else {
    resolved = await resolveAbyss(server.embedUrl);
  }

  const workerOrigin = url.origin;
  const result = buildStreamResponse(resolved, server, { audio, lang, workerOrigin, serverIndex: serverIdx });
  return jsonSuccess(result, { "Cache-Control": "no-store" });
}

// --------------------------------------------------------------------------
// /api/discover — all taxonomy at once
// --------------------------------------------------------------------------
async function handleDiscover(ctx) {
  return cached("discover", CACHE_TTL.taxonomy, async () => {
    const html = await fetchUpstream("/");
    return parseTaxonomy(html);
  }, ctx);
}

async function handleGenres(ctx) {
  return cached("genres", CACHE_TTL.taxonomy, async () => {
    const html = await fetchUpstream("/category/genre/");
    const items = parseTaxonomyList(html, "genre");
    return items;
  }, ctx);
}

// --------------------------------------------------------------------------
// /proxy/media — delegate to media-proxy module
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Parser stubs (full implementations live in src/api/parsers.js)
// --------------------------------------------------------------------------
// These delegate to the parsers module. Inlined here as fallbacks for any
// that haven't been wired yet — replace with real imports.

function parseFeatured(html) {
  // Delegates to parsers.js
  const { parseFeatured } = require("./api/parsers.js");
  return parseFeatured(html);
}
function parseLatest(html) {
  const { parseLatest } = require("./api/parsers.js");
  return parseLatest(html);
}
function parseCatalogItems(html) {
  const { parseCatalogItems } = require("./api/parsers.js");
  return parseCatalogItems(html);
}
function parseRandomItem(html) {
  const { parseRandomItem } = require("./api/parsers.js");
  return parseRandomItem(html);
}
function parseInfoPage(html, id) {
  const { parseInfoPage } = require("./api/parsers.js");
  return parseInfoPage(html, id);
}
function parseServers(html, ep) {
  const { parseServers } = require("./api/parsers.js");
  return parseServers(html, ep);
}
function parseTaxonomy(html) {
  const { parseTaxonomy } = require("./api/parsers.js");
  return parseTaxonomy(html);
}
function parseTaxonomyList(html, kind) {
  const { parseTaxonomyList } = require("./api/parsers.js");
  return parseTaxonomyList(html, kind);
}

function groupBySeason(eps) {
  const g = {};
  for (const e of eps) {
    const s = String(e.season || 1);
    (g[s] = g[s] || []).push(e);
  }
  for (const s of Object.keys(g)) g[s].sort((a, b) => a.num - b.num);
  return g;
}

function buildStreamResponse(resolved, server, { audio, lang, workerOrigin, serverIndex }) {
  const { proxyMediaUrl } = require("./api/media-proxy.js");
  const result = {
    host: server.serverName || `Server ${serverIndex + 1}`,
    serverIndex,
    selectedLanguage: lang || null,
    selected_audio: audio || null,
  };

  if (resolved.isIframe) {
    return { ...result, isIframe: true, embedUrl: resolved.embedUrl };
  }

  const hlsUrl = resolved.direct_hls || resolved.direct_url;
  if (!hlsUrl) return { ...result, isIframe: true, embedUrl: server.embedUrl, error: "No playable URL" };

  const referer = resolved.referer || new URL(hlsUrl).origin + "/";
  result.proxied_url = proxyMediaUrl(workerOrigin, hlsUrl, { referer, audio });
  result.direct_hls = hlsUrl;
  result.referer = referer;
  result.qualities = resolved.qualities || [];
  result.poster = resolved.poster || null;
  result.isIframe = false;

  // Subtitles — proxied through /proxy/media with force=text/vtt
  result.subtitles = (resolved.subtitles || []).map(s => ({
    label: s.label || "Sub",
    url: proxyMediaUrl(workerOrigin, s.url, {
      referer: s.referer || referer,
      force: "text/vtt",
    }),
  }));

  // Audio/subtitle languages from the master playlist (when proxied)
  result.audio_languages = resolved.audio_languages || [];
  result.subtitle_languages = resolved.subtitle_languages || [];

  return result;
}

// --------------------------------------------------------------------------
// MAIN ROUTER
// --------------------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ----- Health -----
      if (path === "/api/health") return await handleHealth(ctx);

      // ----- Modular Home -----
      if (path === "/api/home/hero") return await handleHomeHero(ctx);
      if (path.startsWith("/api/home/")) {
        const section = path.replace("/api/home/", "");
        return await handleHomeSection(section, ctx);
      }
      // Legacy /api/home → redirect client to modular endpoints
      if (path === "/api/home") {
        return jsonSuccess({
          _deprecated: "Use /api/home/hero + /api/home/<section> in parallel",
          sections: Object.keys(SECTION_FETCHERS),
        });
      }

      // ----- Random -----
      if (path === "/api/random") return await handleRandom(ctx);

      // ----- Catalog -----
      if (path === "/api/series")    return await handleCatalog("series", ctx, url);
      if (path === "/api/movies")    return await handleCatalog("movies", ctx, url);
      if (path === "/api/anime")     return await handleCatalog("anime", ctx, url);
      if (path === "/api/cartoon")   return await handleCatalog("cartoon", ctx, url);
      if (path === "/api/ongoing")   return await handleCatalog("ongoing", ctx, url);
      if (path === "/api/completed") return await handleCatalog("completed", ctx, url);
      if (path === "/api/fresh-drops") return await handleCatalog("fresh-drops", ctx, url);

      // ----- Popular -----
      if (path === "/api/popular")           return await handleCatalog("popular", ctx, url);
      if (path === "/api/popular/series")    return await handleCatalog("popular/series", ctx, url);
      if (path === "/api/popular/films")     return await handleCatalog("popular/films", ctx, url);

      // ----- Taxonomy -----
      if (path === "/api/discover") return await handleDiscover(ctx);
      if (path === "/api/genres")   return jsonSuccess(await handleGenres(ctx));
      for (const kind of TAXONOMY_KINDS) {
        const m = path.match(new RegExp(`^/api/${kind}/([^/]+)$`));
        if (m) return await handleTaxonomy(kind, m[1], ctx, url);
      }

      // ----- Search -----
      if (path === "/api/search") return await handleSearch(ctx, url);

      // ----- Info / Episodes -----
      if (path === "/api/info") return await handleInfo(ctx, url);
      if (path.startsWith("/api/episodes/")) {
        const id = decodeURIComponent(path.replace("/api/episodes/", ""));
        return await handleEpisodes(id, ctx, url);
      }

      // ----- Streaming -----
      if (path === "/api/servers") return await handleServers(ctx, url);
      if (path === "/api/stream")  return await handleStream(ctx, url);

      // ----- Media proxy -----
      if (path === "/proxy/media") return await handleMediaProxy(request);

      // ----- Root / 404 -----
      if (path === "/" || path === "") {
        return new Response(
          `AnimeSalt API v3.38.0-modular\n` +
          `\n` +
          `Modular home: /api/home/hero, /api/home/<section>\n` +
          `Sections: ${Object.keys(SECTION_FETCHERS).join(", ")}\n` +
          `Health: /api/health\n` +
          `Docs: see README\n`,
          { headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      }

      return jsonError("Not found", 404);
    } catch (e) {
      console.error("Router error:", e);
      return jsonError(e.message || "Internal error", 500);
    }
  },
};