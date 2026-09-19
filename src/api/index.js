// ==========================================================================
// AnimeSalt Cloudflare Worker — Main Router (v3.41.0)
// Modular: parsers imported from ./parsers.js
// Includes: semaphore-gated fetches, SWR cache, self-audit endpoint
// ==========================================================================

import {
  parseCatalogItems,
  parseFeatured,
  parseLatest,
  parseRandomItem,
  parseInfoPage,
  parseServers,
  parseTaxonomy,
  parseMostWatched,
} from "./parsers.js";

// --------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------
const UPSTREAM = "https://animesalt-proxy.v1nx.workers.dev";
const CHROME_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

// --------------------------------------------------------------------------
// Semaphore — cap parallel upstream fetches (prevents CPU spikes / 1102)
// --------------------------------------------------------------------------
function semaphore(max) {
  let active = 0, queue = [];
  return (fn) => new Promise((resolve, reject) => {
    const run = async () => {
      active++;
      try { resolve(await fn()); } catch (e) { reject(e); }
      finally { active--; if (queue.length) queue.shift()(); }
    };
    active < max ? run() : queue.push(run);
  });
}
const gate = semaphore(6);

// --------------------------------------------------------------------------
// Upstream fetch — timeout + retry + semaphore-gated
// --------------------------------------------------------------------------
async function fetchUpstream(path, opts = {}) {
  const url = UPSTREAM + path;
  const { timeoutMs = 10000, retries = 2 } = opts;
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await gate(() => fetch(url, { headers: CHROME_HEADERS, redirect: "follow", signal: ctrl.signal }));
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr || new Error("Upstream unreachable");
}

// --------------------------------------------------------------------------
// JSON helpers
// --------------------------------------------------------------------------
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=60", "Access-Control-Allow-Origin": "*", ...extra },
  });
}
const jsonSuccess = (data, extra = {}) => json({ success: true, data }, 200, extra);
const jsonError = (msg, status = 500) => json({ success: false, error: msg }, status);

// --------------------------------------------------------------------------
// Cache wrapper — stale-while-revalidate
// --------------------------------------------------------------------------
async function cached(key, ttl, compute, ctx) {
  const cache = caches.default;
  const url = new URL(`https://__cache/${encodeURIComponent(key)}`);
  let res = await cache.match(url);
  if (res) {
    if (ctx && ctx.waitUntil) ctx.waitUntil((async () => {
      try {
        const body = await compute();
        const payload = typeof body === "string" ? body : JSON.stringify(body);
        await cache.put(url, new Response(payload, {
          headers: { "Content-Type": "application/json", "Cache-Control": `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}`, "Access-Control-Allow-Origin": "*" },
        }));
      } catch {}
    })());
    return res;
  }
  const body = await compute();
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res = new Response(payload, {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}`, "Access-Control-Allow-Origin": "*" },
  });
  try { await cache.put(url, res.clone()); } catch {}
  return res;
}

// ==========================================================================
// DECRYPTORS
// ==========================================================================
function decodeMultiLang(embedUrl) {
  const m = embedUrl.match(/data=([A-Za-z0-9+/=]+)/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(atob(m[1]));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function resolveAsCdn26(embedUrl) {
  try {
    const idMatch = embedUrl.match(/\/video\/([a-f0-9]+)/);
    if (!idMatch) return { embedUrl, isIframe: true };
    const videoId = idMatch[1];
    const playerRes = await fetch(embedUrl, { headers: { ...CHROME_HEADERS, Referer: "https://as-cdn26.top/" } });
    const playerHtml = await playerRes.text();

    const subtitles = [];
    const subVar = playerHtml.match(/var\s+playerjsSubtitle\s*=\s*["']([^"']*)["']/i);
    if (subVar) {
      const re = /\[([^\]]+)\]\s*(https?:\/\/[^"'\s,;]+)/g;
      let pm;
      while ((pm = re.exec(subVar[1])) !== null) {
        subtitles.push({ label: pm[1].trim(), url: pm[2].trim(), referer: new URL(pm[2]).origin + "/" });
      }
    }

    const apiUrl = `https://as-cdn26.top/player/index.php?data=${videoId}&do=getVideo`;
    const apiRes = await fetch(apiUrl, {
      method: "POST",
      headers: { ...CHROME_HEADERS, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", Referer: embedUrl },
      body: `hash=${videoId}&r=`,
    });

    if (apiRes.ok) {
      try {
        const j = await apiRes.json();
        (j.tracks || []).forEach(t => (t.kind === "captions" || t.kind === "subtitles") && t.file && subtitles.push({ label: t.label || t.language || "Sub", url: String(t.file).replace(/\\\//g, "/"), referer: "https://as-cdn26.top/" }));
        if (j.videoSource || j.securedLink) {
          return { direct_hls: j.videoSource || j.securedLink, qualities: [], subtitles, poster: j.videoImage || null, isIframe: false };
        }
      } catch {}
    }

    const m3u8 = playerHtml.match(/(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i);
    if (m3u8) return { direct_hls: m3u8[1], qualities: [], subtitles, isIframe: false };
    return { embedUrl, isIframe: true };
  } catch { return { embedUrl, isIframe: true }; }
}

async function resolveAbyss(embedUrl) {
  try {
    const res = await fetch(embedUrl, { headers: CHROME_HEADERS, redirect: "follow" });
    if (!res.ok) return { embedUrl, isIframe: true };
    const html = await res.text();
    const m3u8 = html.match(/(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i);
    if (m3u8) return { direct_hls: m3u8[1], qualities: [], subtitles: [], isIframe: false };
    const mp4 = html.match(/(https?:\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*)/i);
    if (mp4) return { direct_url: mp4[1], direct_hls: mp4[1], qualities: [], subtitles: [], isIframe: false };
    return { embedUrl, isIframe: true };
  } catch { return { embedUrl, isIframe: true }; }
}

// ==========================================================================
// MEDIA PROXY
// ==========================================================================
function proxyMediaUrl(workerOrigin, url, params = {}) {
  const u = new URL("/proxy/media", workerOrigin);
  u.searchParams.set("url", url);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

async function handleMediaProxy(request) {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");
  let referer = url.searchParams.get("referer");
  const forceType = url.searchParams.get("force");
  if (!targetUrl) return new Response("Missing url", { status: 400, headers: corsHeaders });
  if (!referer) { try { referer = new URL(targetUrl).origin + "/"; } catch { referer = ""; } }

  const candidates = [referer, "", new URL(targetUrl).origin + "/", "https://as-cdn26.top/"].filter((v, i, a) => v && a.indexOf(v) === i);
  let res, lastStatus;
  for (const r of candidates) {
    const h = new Headers({ "User-Agent": CHROME_HEADERS["User-Agent"], "Accept": "*/*" });
    if (r) { h.set("Referer", r); try { h.set("Origin", new URL(r).origin); } catch {} }
    const rng = request.headers.get("Range");
    if (rng) h.set("Range", rng);
    try { res = await fetch(targetUrl, { headers: h, redirect: "follow" }); } catch { continue; }
    if (res.ok) break;
    lastStatus = res.status;
    try { if (res.body) await res.body.cancel(); } catch {}
    if (lastStatus !== 403 && lastStatus !== 404) break;
  }
  if (!res || !res.ok) {
    if (forceType === "text/vtt") return new Response("WEBVTT\n\n", { headers: { "Content-Type": "text/vtt", "Access-Control-Allow-Origin": "*" } });
    return new Response(`Upstream error: ${lastStatus || "unknown"}`, { status: 502, headers: corsHeaders });
  }

  const ct = (res.headers.get("Content-Type") || "").toLowerCase();
  if (forceType === "text/vtt") {
    const text = await res.text();
    const isImage = /^\u00FF\u00D8\u00FF|\u0089PNG|GIF8|RIFF/.test(text);
    if (isImage) return new Response("WEBVTT\n\n", { headers: { "Content-Type": "text/vtt", "Access-Control-Allow-Origin": "*" } });
    const vtt = text.trimStart().startsWith("WEBVTT") ? text : "WEBVTT\n\n" + text.replace(/\r\n/g, "\n");
    return new Response(vtt, { headers: { "Content-Type": "text/vtt", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } });
  }

  const reader = res.body.getReader();
  const first = await reader.read();
  const headText = first.value ? new TextDecoder().decode(first.value.subarray(0, 64)) : "";
  if (!first.done && headText.trimStart().startsWith("#EXTM3U")) {
    let text = new TextDecoder().decode(first.value);
    for (;;) { const r = await reader.read(); if (r.done) break; text += new TextDecoder().decode(r.value); }
    const lines = text.split(/\r?\n/);
    const out = lines.map(line => {
      if (!line.trim()) return line;
      if (!line.startsWith("#")) {
        try { return proxyMediaUrl(url.origin, new URL(line.trim(), targetUrl).toString(), { referer }); } catch { return line; }
      }
      return line.replace(/URI="([^"]+)"/g, (_, uri) => {
        try { return `URI="${proxyMediaUrl(url.origin, new URL(uri, targetUrl).toString(), { referer })}"`; } catch { return `URI="${uri}"`; }
      });
    });
    return new Response(out.join("\n"), { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" } });
  }
  const stream = new ReadableStream({
    async start(c) { if (first.value) c.enqueue(first.value); },
    async pull(c) { const r = await reader.read(); r.done ? c.close() : c.enqueue(r.value); },
  });
  const rh = new Headers({ "Access-Control-Allow-Origin": "*", "Content-Type": ct || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
  ["Content-Range", "Content-Length"].forEach(h => res.headers.has(h) && rh.set(h, res.headers.get(h)));
  return new Response(stream, { status: res.status, headers: rh });
}

// ==========================================================================
// EPISODES — AJAX + synthesis fallback
// ==========================================================================
async function getEpisodesData(animeId, requestedSeason) {
  const html = await fetchUpstream(`/series/${animeId}/`);
  const postIdM = html.match(/postid-(\d+)/i) || html.match(/data-post="(\d+)"/i);
  const postId = postIdM ? postIdM[1] : null;
  const nonceM = html.match(/"nonce"\s*:\s*"([a-z0-9]+)"/i) || html.match(/ajax_nonce\s*=\s*"([a-z0-9]+)"/i);
  const nonce = nonceM ? nonceM[1] : "";

  const seasons = [];
  const selectM = html.match(/<select[^>]*class="[^"]*sel-temp[^"]*"[^>]*>([\s\S]*?)<\/select>/i);
  if (selectM) {
    const re = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
    let m;
    while ((m = re.exec(selectM[1])) !== null) {
      const label = m[2].replace(/<[^>]+>/g, "").trim();
      const sNum = parseInt((label.match(/Season\s*(\d+)/i) || m[1].match(/^(\d+)$/))?.[1], 10);
      if (sNum > 0 && !seasons.find(s => s.num === sNum)) seasons.push({ num: sNum, title: label, value: m[1] });
    }
  }
  if (!seasons.length) {
    const re = /<(?:button|li|a)[^>]*data-season="(\d+)"[^>]*>([\s\S]*?)<\/(?:button|li|a)>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const sNum = parseInt(m[1], 10);
      if (sNum > 0 && !seasons.find(s => s.num === sNum)) seasons.push({ num: sNum, title: m[2].replace(/<[^>]+>/g, "").trim(), value: m[1] });
    }
  }

  const targets = requestedSeason === "all" ? seasons : seasons.filter(s => s.num === requestedSeason);
  const settled = await Promise.all(targets.map(async (s) => {
    let eps = [];
    try {
      if (!postId) throw new Error("no post id");
      const body = new URLSearchParams({ action: "action_select_temp", temp: s.value || String(s.num), season: s.value || String(s.num), post: postId, ...(nonce ? { nonce } : {}) }).toString();
      const fragRes = await fetch(`${UPSTREAM}/wp-admin/admin-ajax.php`, {
        method: "POST",
        headers: { ...CHROME_HEADERS, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
        body,
      });
      const frag = await fragRes.text();
      if (frag.includes("/episode/")) {
        const re = /<a[^>]+href="(https:\/\/animesalt\.cx\/episode\/([^"\/]+)\/?)"/gi;
        let m;
        while ((m = re.exec(frag)) !== null) {
          const sxe = m[2].match(/(\d+)x(\d+)/);
          const num = sxe ? parseInt(sxe[2], 10) : 0;
          if (num > 0) eps.push({ num, season: s.num, title: `Episode ${num}`, slug: m[2], url: m[1], image: null, regionalDub: true });
        }
      }
    } catch {}

    // Synthesis fallback from published season range
    if (!eps.length) {
      const range = s.title.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (range) {
        for (let e = +range[1]; e <= +range[2]; e++) {
          eps.push({
            num: e, season: s.num, title: `Episode ${e}`,
            slug: `${animeId}-${s.num}x${e}`,
            url: `https://animesalt.cx/episode/${animeId}-${s.num}x${e}/`,
            image: postId ? `https://img.animesalt.cx/image/${postId}/${s.num}/${e}.webp` : null,
            regionalDub: true, synthesized: true,
          });
        }
      }
    }
    return { num: s.num, eps, failed: !eps.length };
  }));

  const episodes = [];
  const failedSeasons = [];
  for (const r of settled) { r.eps.length ? episodes.push(...r.eps) : failedSeasons.push(r.num); }
  episodes.sort((a, b) => a.season - b.season || a.num - b.num);
  return { seasons, episodes, failedSeasons };
}

// ==========================================================================
// ROUTE HANDLERS
// ==========================================================================
async function handleHealth(ctx) {
  return cached("health", 300, async () => {
    const start = Date.now();
    let online = false, error = null;
    try { const r = await fetch(UPSTREAM + "/", { headers: CHROME_HEADERS }); online = r.status < 500; } catch (e) { error = e.message; }
    return { success: true, status: online ? "healthy" : "degraded", timestamp: new Date().toISOString(), upstream: { source: UPSTREAM, online, latencyMs: Date.now() - start, error }, version: "3.41.0" };
  }, ctx);
}

async function handleHomeHero(ctx) {
  return cached("home:hero", 3600, async () => {
    const html = await fetchUpstream("/");
    return {
      featured: parseFeatured(html).slice(0, 6),
      tickerItems: parseLatest(html).slice(0, 14).map(it => ({ title: it.title, sub: "new drop" })),
    };
  }, ctx);
}

// Corrected upstream paths
const SECTION_FETCHERS = {
  "latest": () => fetchUpstream("/").then(parseLatest),
  "most-watched-series": () => fetchUpstream("/").then(h => parseMostWatched(h).series),
  "most-watched-films": () => fetchUpstream("/").then(h => parseMostWatched(h).films),
  "fresh-drops": () => fetchUpstream("/").then(parseCatalogItems).then(d => d.slice(0, 12)),
  "ongoing": () => fetchUpstream("/category/status/ongoing/").then(parseCatalogItems),
  "completed": () => fetchUpstream("/category/status/completed/").then(parseCatalogItems),
  "movies": () => fetchUpstream("/movies/").then(parseCatalogItems),
};

async function handleHomeSection(section, ctx) {
  const fetcher = SECTION_FETCHERS[section];
  if (!fetcher) return jsonError(`Unknown section: ${section}`, 404);
  return cached(`home:section:${section}`, 1800, async () => {
    try { return await fetcher(); } catch (e) { console.error(`Section ${section} failed:`, e.message); return []; }
  }, ctx);
}

async function handleRandom(ctx) {
  return cached("random", 600, async () => {
    const html = await fetchUpstream("/");
    return parseRandomItem(html);
  }, ctx);
}

const CATALOG_PATHS = {
  "series": "/series/",
  "movies": "/movies/",
  "anime": "/category/anime/",
  "cartoon": "/category/cartoon/",
  "ongoing": "/category/status/ongoing/",
  "completed": "/category/status/completed/",
  "fresh-drops": "/",
  "popular": "/",
  "popular/series": "/",
  "popular/films": "/",
};

async function handleCatalog(kind, ctx, url) {
  const page = Number(url.searchParams.get("page") || 1);
  const upstreamPath = CATALOG_PATHS[kind] || `/${kind}/`;
  return cached(`cat:${kind}:p${page}`, 21600, async () => {
    try {
      const html = await fetchUpstream(upstreamPath + (page > 1 ? `page/${page}/` : ""));
      let items = parseCatalogItems(html);
      if (kind === "popular/series") items = items.filter(i => i.type === "series").map((it, i) => ({ rank: i + 1, ...it }));
      if (kind === "popular/films") items = items.filter(i => i.type === "movie").map((it, i) => ({ rank: i + 1, ...it }));
      if (kind === "popular") items = items.map((it, i) => ({ rank: i + 1, ...it }));
      return { page, data: items };
    } catch (e) { return { page, data: [], error: e.message }; }
  }, ctx);
}

async function handleTaxonomy(kind, slug, ctx, url) {
  const page = Number(url.searchParams.get("page") || 1);
  return cached(`tax:${kind}:${slug}:p${page}`, 86400, async () => {
    try {
      const html = await fetchUpstream(`/category/${kind}/${slug}/${page > 1 ? `page/${page}/` : ""}`);
      return { page, [kind]: slug, data: parseCatalogItems(html) };
    } catch (e) { return { page, [kind]: slug, data: [], error: e.message }; }
  }, ctx);
}

async function handleSearch(ctx, url) {
  const keyword = url.searchParams.get("keyword");
  const page = Number(url.searchParams.get("page") || 1);
  if (!keyword) return jsonError("Missing keyword", 400);
  return cached(`search:${keyword.toLowerCase()}:p${page}`, 300, async () => {
    const html = await fetchUpstream(`/?s=${encodeURIComponent(keyword)}${page > 1 ? `&paged=${page}` : ""}`);
    return { page, data: parseCatalogItems(html) };
  }, ctx);
}

async function handleInfo(ctx, url) {
  const id = url.searchParams.get("id");
  if (!id) return jsonError("Missing id", 400);
  return cached(`info:${id}`, 1800, async () => parseInfoPage(await fetchUpstream(`/series/${id}/`), id), ctx);
}

async function handleEpisodes(id, ctx, url) {
  const season = url.searchParams.get("season") || "all";
  return cached(`eps:${id}:s${season}`, 1800, async () => {
    const r = await getEpisodesData(id, season === "all" ? "all" : Number(season));
    const g = {};
    for (const e of r.episodes) (g[String(e.season)] = g[String(e.season)] || []).push(e);
    for (const s of Object.keys(g)) g[s].sort((a, b) => a.num - b.num);
    return {
      animeId: id,
      requestedSeason: season === "all" ? null : Number(season),
      availableSeasons: r.seasons.map(s => s.num),
      totalEpisodes: r.episodes.length,
      failedSeasons: r.failedSeasons,
      groupedEpisodes: g,
    };
  }, ctx);
}

async function handleServers(ctx, url) {
  const ep = url.searchParams.get("ep");
  if (!ep) return jsonError("Missing ep", 400);
  return cached(`srv:${ep}`, 300, async () => {
    const servers = parseServers(await fetchUpstream(`/episode/${ep}/`), ep);
    // Populate multi-lang languages from base64 payload
    for (const s of servers) {
      if (s.isMultiLang) s.languages = decodeMultiLang(s.embedUrl).map(l => ({ language: l.language, link: String(l.link || "").replace(/\\\//g, "/") }));
    }
    return servers;
  }, ctx);
}

async function handleStream(ctx, url) {
  const ep = url.searchParams.get("ep");
  const serverIdx = Number(url.searchParams.get("server") || 0);
  const lang = url.searchParams.get("lang");
  const audio = url.searchParams.get("audio");
  if (!ep) return jsonError("Missing ep", 400);

  const srvRes = await handleServers(ctx, url);
  const servers = (await srvRes.clone().json()).data || [];
  const server = servers[serverIdx];
  if (!server) return jsonError("Server not found", 404);

  let embedUrl = server.embedUrl;
  let selectedLanguage = lang || null;
  if (server.isMultiLang && server.languages.length) {
    const pick = lang
      ? server.languages.find(l => String(l.language).toLowerCase() === lang.toLowerCase())
      : server.languages.find(l => /eng/i.test(l.language)) || server.languages[0];
    if (pick) { embedUrl = pick.link; selectedLanguage = pick.language; }
  }

  const resolved = /as-cdn/i.test(embedUrl) ? await resolveAsCdn26(embedUrl) : await resolveAbyss(embedUrl);
  const result = { host: server.serverName, serverIndex: serverIdx, selectedLanguage, selected_audio: audio || null };

  if (resolved.isIframe) return jsonSuccess({ ...result, isIframe: true, embedUrl: resolved.embedUrl }, { "Cache-Control": "no-store" });
  const hlsUrl = resolved.direct_hls;
  if (!hlsUrl) return jsonSuccess({ ...result, isIframe: true, embedUrl: server.embedUrl, error: "No playable URL" }, { "Cache-Control": "no-store" });

  const referer = resolved.referer || new URL(hlsUrl).origin + "/";
  result.proxied_url = proxyMediaUrl(url.origin, hlsUrl, { referer, audio });
  result.direct_hls = hlsUrl;
  result.referer = referer;
  result.qualities = resolved.qualities || [];
  result.poster = resolved.poster || null;
  result.isIframe = false;
  result.subtitles = (resolved.subtitles || []).map(s => ({
    label: s.label || "Sub",
    url: proxyMediaUrl(url.origin, s.url, { referer: s.referer || referer, force: "text/vtt" }),
  }));
  result.audio_languages = resolved.audio_languages || [];
  result.subtitle_languages = resolved.subtitle_languages || [];
  return jsonSuccess(result, { "Cache-Control": "no-store" });
}

async function handleDiscover(ctx) {
  return cached("discover", 86400, async () => parseTaxonomy(await fetchUpstream("/")), ctx);
}

async function handleGenreList(ctx) {
  return cached("genres", 86400, async () => parseTaxonomy(await fetchUpstream("/")).genres, ctx);
}

// --------------------------------------------------------------------------
// Self-audit: probe every route + upstream path, report discrepancies
// --------------------------------------------------------------------------
async function handleAudit(request, ctx) {
  const origin = new URL(request.url).origin;
  const routes = [
    "/api/health", "/api/home/hero", "/api/home/latest",
    "/api/home/most-watched-series", "/api/home/most-watched-films",
    "/api/home/fresh-drops", "/api/home/ongoing", "/api/home/completed", "/api/home/movies",
    "/api/series?page=1", "/api/movies?page=1", "/api/anime?page=1", "/api/cartoon?page=1",
    "/api/ongoing?page=1", "/api/completed?page=1", "/api/fresh-drops?page=1",
    "/api/popular", "/api/popular/series", "/api/popular/films",
    "/api/random", "/api/search?keyword=naruto", "/api/info?id=spy-x-family",
    "/api/episodes/spy-x-family?season=all", "/api/servers?ep=spy-x-family-1x1",
    "/api/discover", "/api/genres", "/api/genre/action?page=1",
    "/api/language/english?page=1", "/api/network/cartoon-network?page=1",
    "/api/franchise/ben-10?page=1", "/api/type/series?page=1", "/api/year/2024?page=1",
  ];
  const upstreams = [
    "/", "/series/", "/movies/", "/category/anime/", "/category/cartoon/",
    "/category/status/ongoing/", "/category/status/completed/",
    "/category/network/cartoon-network/", "/category/franchise/ben-10/",
    "/category/genre/action/", "/category/language/english/",
  ];

  const routeReport = [];
  for (const r of routes) {
    try {
      const res = await fetch(origin + r, { headers: { "X-Audit": "1" } });
      let items = null, err = null, sample = null;
      try {
        const j = await res.json();
        const d = j.data;
        if (Array.isArray(d)) {
          items = d.length;
          if (d[0]) sample = { id: d[0].id, title: d[0].title, hasImage: !!(d[0].image && !String(d[0].image).startsWith("data:")) };
        } else if (d && typeof d === "object") items = Object.keys(d).length;
        err = j.error || null;
      } catch {}
      routeReport.push({
        route: r, status: res.status, items, error: err, sample,
        discrepancy: res.status !== 200 || !!err || items === 0 || (sample && sample.hasImage === false),
      });
    } catch (e) {
      routeReport.push({ route: r, status: "EXC", error: e.message, discrepancy: true });
    }
  }

  const upstreamReport = [];
  for (const u of upstreams) {
    try {
      const res = await fetch(UPSTREAM + u, { headers: CHROME_HEADERS, redirect: "follow" });
      upstreamReport.push({ path: u, status: res.status, exists: res.status < 400 });
      try { if (res.body) await res.body.cancel(); } catch {}
    } catch (e) {
      upstreamReport.push({ path: u, status: "EXC", exists: false });
    }
  }

  return jsonSuccess({
    generatedAt: new Date().toISOString(),
    discrepancies: routeReport.filter(r => r.discrepancy),
    routes: routeReport,
    upstream: upstreamReport,
  }, { "Cache-Control": "no-store" });
}

// ==========================================================================
// MAIN ROUTER
// ==========================================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    try {
      if (path === "/api/health") return await handleHealth(ctx);

      // Modular home
      if (path === "/api/home/hero") return await handleHomeHero(ctx);
      if (path.startsWith("/api/home/")) return await handleHomeSection(path.replace("/api/home/", ""), ctx);
      if (path === "/api/home") return jsonSuccess({ _deprecated: "Use /api/home/hero + /api/home/<section> in parallel", sections: Object.keys(SECTION_FETCHERS) });

      if (path === "/api/random") return await handleRandom(ctx);

      // Catalog
      for (const k of Object.keys(CATALOG_PATHS)) {
        if (path === `/api/${k}`) return await handleCatalog(k, ctx, url);
      }

      // Taxonomy
      if (path === "/api/discover") return await handleDiscover(ctx);
      if (path === "/api/genres") return jsonSuccess(await handleGenreList(ctx));
      for (const kind of ["genre", "language", "country", "type", "year", "network", "franchise", "status"]) {
        const m = path.match(new RegExp(`^/api/${kind}/([^/]+)$`));
        if (m) return await handleTaxonomy(kind, decodeURIComponent(m[1]), ctx, url);
      }

      // Search / info / episodes
      if (path === "/api/search") return await handleSearch(ctx, url);
      if (path === "/api/info") return await handleInfo(ctx, url);
      if (path.startsWith("/api/episodes/")) return await handleEpisodes(decodeURIComponent(path.replace("/api/episodes/", "")), ctx, url);

      // Streaming
      if (path === "/api/servers") return await handleServers(ctx, url);
      if (path === "/api/stream") return await handleStream(ctx, url);

      // Media proxy
      if (path === "/proxy/media") return await handleMediaProxy(request);

      // Self-audit
      if (path === "/api/debug/audit") return await handleAudit(request, ctx);

      // Root
      if (path === "/" || path === "") {
        return new Response(
          `AnimeSalt API v3.41.0\n\n` +
          `Modular home: /api/home/hero, /api/home/<section>\n` +
          `Sections: ${Object.keys(SECTION_FETCHERS).join(", ")}\n` +
          `Self-audit: /api/debug/audit\n`,
          { headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      }

      return jsonError("Not found", 404);
    } catch (e) {
      return jsonError(e.message || "Internal error", 500);
    }
  },
};