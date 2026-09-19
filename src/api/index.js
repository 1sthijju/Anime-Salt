// ==========================================================================
// AnimeSalt Cloudflare Worker — FIXED (v3.40.0)
// Corrected upstream paths + robust parser
// ==========================================================================

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
// Semaphore + fetch helpers
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
// Cache wrapper
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
// FIXED PARSERS — multiple pattern matching
// ==========================================================================

function parseCatalogItems(html) {
  const out = [];
  
  // Pattern 1: Standard article with data attributes
  const pattern1 = /<article[^>]*>[\s\S]*?<a[^>]+href="(https:\/\/animesalt\.cx\/(?:series|movies)\/([^"\/]+)\/?)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>[\s\S]*?<h[23][^>]*>([^<]+)<\/h[23]>/gi;
  let m;
  while ((m = pattern1.exec(html)) !== null) {
    const [, url, slug, img, title] = m;
    out.push({ id: slug, title: title.trim(), image: img, type: url.includes("/movies/") ? "movie" : "series", url });
  }
  
  // Pattern 2: Simpler card structure
  if (out.length === 0) {
    const pattern2 = /<a[^>]+href="(https:\/\/animesalt\.cx\/(?:series|movies)\/([^"\/]+)\/?)"[^>]*class="[^"]*(?:card|item|poster)[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>[\s\S]*?(?:<h[23][^>]*>([^<]+)<\/h[23]>|alt="([^"]+)")/gi;
    while ((m = pattern2.exec(html)) !== null) {
      const [, url, slug, img, title1, title2] = m;
      const title = (title1 || title2 || "").trim();
      if (title && !title.startsWith("View")) {
        out.push({ id: slug, title, image: img, type: url.includes("/movies/") ? "movie" : "series", url });
      }
    }
  }
  
  // Pattern 3: Extract from structured data (JSON-LD or data attributes)
  if (out.length === 0) {
    const pattern3 = /data-post-id="(\d+)"[^>]*data-slug="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>[\s\S]*?<h[23][^>]*>([^<]+)<\/h[23]>/gi;
    while ((m = pattern3.exec(html)) !== null) {
      const [, , slug, img, title] = m;
      out.push({ id: slug, title: title.trim(), image: img, type: "series", url: `https://animesalt.cx/series/${slug}/` });
    }
  }
  
  // Dedupe by id
  const seen = new Set();
  return out.filter(it => { if (seen.has(it.id)) return false; seen.add(it.id); return true; });
}

function parseFeatured(html) {
  // Try multiple patterns for featured/hero content
  const patterns = [
    /<div[^>]*class="[^"]*(?:hero|featured|slider|spotlight)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi,
    /<section[^>]*class="[^"]*(?:hero|featured|spotlight)[^"]*"[^>]*>([\s\S]*?)<\/section>/gi,
    /<div[^>]*id="[^"]*(?:hero|featured|slider)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ];
  
  for (const pattern of patterns) {
    const items = [];
    let m;
    while ((m = pattern.exec(html)) !== null) {
      const block = m[1];
      const urlM = block.match(/href="(https:\/\/animesalt\.cx\/(series|movies)\/([^"\/]+)\/?)"/);
      const imgM = block.match(/<img[^>]+src="([^"]+)"/);
      const tiM = block.match(/<(?:h[123]|p)[^>]*>([^<]{3,100})<\/(?:h[123]|p)>/);
      if (urlM && tiM) {
        items.push({
          id: urlM[3],
          title: tiM[1].trim(),
          image: imgM ? imgM[1] : "",
          type: urlM[2] === "series" ? "series" : "movie",
          url: urlM[1],
        });
      }
    }
    if (items.length > 0) return items;
  }
  
  // Fallback: use parseCatalogItems
  return parseCatalogItems(html).slice(0, 6);
}

function parseLatest(html) {
  return parseCatalogItems(html).slice(0, 24);
}

function parseRandomItem(html) {
  const items = parseCatalogItems(html);
  return items.length ? items[Math.floor(Math.random() * items.length)] : null;
}

function parseInfoPage(html, id) {
  const titleM = html.match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h1>/i) || html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const posterM = html.match(/<div[^>]*class="[^"]*poster[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i);
  const descM = html.match(/<div[^>]*class="[^"]*(?:description|wp-content|entry-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  
  const genres = [...html.matchAll(/<a[^>]+href="[^"]*\/category\/genre\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi)].map(m => m[2].trim());
  const languages = [...html.matchAll(/<a[^>]+href="[^"]*\/category\/language\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi)].map(m => m[2].trim());
  
  const seasonsRaw = [...html.matchAll(/<option[^>]+value="(\d+)"[^>]*>Season\s*(\d+)[\s\S]*?(\d+)\s*[-–]\s*(\d+)\s*\((\d+)\)/gi)];
  const seasons = seasonsRaw.map(m => ({ num: +m[2], title: `Season ${m[2]} • ${m[3]}-${m[4]} (${m[5]})`, value: m[1] }));
  
  return {
    id,
    title: (titleM ? titleM[1] : id).trim(),
    poster: posterM ? posterM[1] : "",
    backdrop: "",
    description: descM ? descM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "",
    type: html.includes("/movies/") ? "movie" : "series",
    totalEpisodes: seasons.reduce((sum, s) => sum + (parseInt(s.title.match(/\((\d+)\)/)?.[1] || 0, 10)), 0),
    year: "",
    status: "",
    seasons,
    genres,
    languages,
    runtime: "",
    quickPlay: {
      first: seasons[0] ? { season: seasons[0].num, episode: 1, slug: `${id}-${seasons[0].num}x1` } : null,
      latestDub: seasons.length ? { season: seasons[seasons.length - 1].num, episode: 1, slug: `${id}-${seasons[seasons.length - 1].num}x1` } : null,
      latestSub: null,
    },
  };
}

function parseServers(html, epSlug) {
  const servers = [];
  const re = /<li[^>]*data-id="(\d+)"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [_, idxStr, embedUrl, name] = m;
    servers.push({
      index: parseInt(idxStr, 10),
      serverName: name.trim(),
      embedUrl,
      isMultiLang: /multi-lang/i.test(name),
      languages: [],
    });
  }
  return servers;
}

function parseTaxonomy(html) {
  const parse = (pattern) => [...html.matchAll(pattern)].map(m => ({ slug: m[1], name: m[2].trim() }));
  return {
    genres: parse(/<a[^>]+href="[^"]*\/category\/genre\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi),
    languages: parse(/<a[^>]+href="[^"]*\/category\/language\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi),
    types: [], // Doesn't exist on upstream
    statuses: [], // Doesn't exist on upstream
    networks: parse(/<a[^>]+href="[^"]*\/category\/network\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi),
    franchises: parse(/<a[^>]+href="[^"]*\/category\/franchise\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi),
    topLevel: [],
  };
}

// ==========================================================================
// DECRYPTORS
// ==========================================================================
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
      const j = await apiRes.json();
      if (j.videoSource || j.securedLink) {
        return { direct_hls: j.videoSource || j.securedLink, qualities: [], subtitles, poster: j.videoImage || null, isIframe: false };
      }
    }
    
    const m3u8 = playerHtml.match(/(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i);
    if (m3u8) return { direct_hls: m3u8[1], qualities: [], subtitles, isIframe: false };
    return { embedUrl, isIframe: true };
  } catch { return { embedUrl, isIframe: true }; }
}

async function resolveAbyss(embedUrl) {
  try {
    const res = await fetch(embedUrl, { headers: CHROME_HEADERS });
    if (!res.ok) return { embedUrl, isIframe: true };
    const html = await res.text();
    const m3u8 = html.match(/(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i);
    if (m3u8) return { direct_hls: m3u8[1], qualities: [], subtitles: [], isIframe: false };
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
  if (!referer) referer = new URL(targetUrl).origin + "/";
  
  const candidates = [referer, "", new URL(targetUrl).origin + "/", "https://as-cdn26.top/"].filter(Boolean);
  let res, lastStatus;
  for (const r of candidates) {
    const h = new Headers({ "User-Agent": CHROME_HEADERS["User-Agent"], "Accept": "*/*" });
    if (r) { h.set("Referer", r); try { h.set("Origin", new URL(r).origin); } catch {} }
    const rng = request.headers.get("Range");
    if (rng) h.set("Range", rng);
    try { res = await fetch(targetUrl, { headers: h }); } catch { continue; }
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
    while (true) { const r = await reader.read(); if (r.done) break; text += new TextDecoder().decode(r.value); }
    const lines = text.split(/\r?\n/);
    const out = lines.map(line => {
      if (!line.startsWith("#")) { try { return proxyMediaUrl(url.origin, new URL(line.trim(), targetUrl).toString(), { referer }); } catch { return line; } }
      return line.replace(/URI="([^"]+)"/g, (_, uri) => { try { return `URI="${proxyMediaUrl(url.origin, new URL(uri, targetUrl).toString(), { referer })}"`; } catch { return `URI="${uri}"`; } });
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
// EPISODES
// ==========================================================================
async function getEpisodesData(animeId, requestedSeason) {
  const html = await fetchUpstream(`/series/${animeId}/`);
  const postIdM = html.match(/postid-(\d+)/i);
  const postId = postIdM ? postIdM[1] : null;
  const nonceM = html.match(/"nonce"\s*:\s*"([a-z0-9]+)"/i);
  const nonce = nonceM ? nonceM[1] : "";
  
  const seasons = [];
  const selectM = html.match(/<select[^>]*class="[^"]*sel-temp[^"]*"[^>]*>([\s\S]*?)<\/select>/i);
  if (selectM) {
    const re = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
    let m;
    while ((m = re.exec(selectM[1])) !== null) {
      const sNum = parseInt((m[2].match(/Season\s*(\d+)/i) || m[1].match(/^(\d+)$/))?.[1], 10);
      if (sNum > 0 && !seasons.find(s => s.num === sNum)) seasons.push({ num: sNum, title: m[2].replace(/<[^>]+>/g, "").trim(), value: m[1] });
    }
  }
  
  const targets = requestedSeason === "all" ? seasons : seasons.filter(s => s.num === requestedSeason);
  const settled = await Promise.all(targets.map(async (s) => {
    let eps = [];
    try {
      if (!postId) throw new Error("no post id");
      const body = new URLSearchParams({ action: "action_select_temp", temp: s.value || String(s.num), season: s.value || String(s.num), post: postId, nonce }).toString();
      const fragRes = await fetch(`${UPSTREAM}/wp-admin/admin-ajax.php`, {
        method: "POST", headers: { ...CHROME_HEADERS, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" }, body,
      });
      const frag = await fragRes.text();
      if (frag.includes("/episode/")) {
        const re = /<a[^>]+href="(https:\/\/animesalt\.cx\/episode\/([^"\/]+)\/?)"/gi;
        let m;
        while ((m = re.exec(frag)) !== null) {
          const num = parseInt(m[2].match(/(\d+)x(\d+)/)?.[2], 10) || 0;
          if (num > 0) eps.push({ num, season: s.num, title: `Episode ${num}`, slug: m[2], url: m[1], image: null });
        }
      }
    } catch {}
    
    if (!eps.length) {
      const range = (s.title.match(/(\d+)\s*[-–]\s*(\d+)/));
      if (range) {
        for (let e = +range[1]; e <= +range[2]; e++) {
          eps.push({ num: e, season: s.num, title: `Episode ${e}`, slug: `${animeId}-${s.num}x${e}`, url: `https://animesalt.cx/episode/${animeId}-${s.num}x${e}/`, image: postId ? `https://img.animesalt.cx/image/${postId}/${s.num}/${e}.webp` : null, synthesized: true });
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
// ROUTE HANDLERS — FIXED PATHS
// ==========================================================================
async function handleHealth(ctx) {
  return cached("health", 300, async () => {
    const start = Date.now();
    let online = false, error = null;
    try { const r = await fetch(UPSTREAM + "/", { headers: CHROME_HEADERS }); online = r.status < 500; } catch (e) { error = e.message; }
    return { success: true, status: online ? "healthy" : "degraded", timestamp: new Date().toISOString(), upstream: { source: UPSTREAM, online, latencyMs: Date.now() - start, error }, version: "3.40.0-fixed" };
  }, ctx);
}

async function handleHomeHero(ctx) {
  return cached("home:hero", 3600, async () => {
    const html = await fetchUpstream("/");
    return { featured: parseFeatured(html).slice(0, 6), tickerItems: parseLatest(html).slice(0, 14).map(it => ({ title: it.title, sub: "new drop" })) };
  }, ctx);
}

// FIXED: Use correct upstream paths
const SECTION_FETCHERS = {
  "latest": () => fetchUpstream("/").then(parseCatalogItems).then(d => d.slice(0, 24)),
  "most-watched-series": () => fetchUpstream("/").then(h => parseCatalogItems(h).filter(i => i.type === "series").slice(0, 25)),
  "most-watched-films": () => fetchUpstream("/").then(h => parseCatalogItems(h).filter(i => i.type === "movie").slice(0, 25)),
  "fresh-drops": () => fetchUpstream("/").then(parseCatalogItems).then(d => d.slice(0, 12)), // From homepage
  "ongoing": () => fetchUpstream("/category/status/ongoing/").then(parseCatalogItems), // FIXED path
  "completed": () => fetchUpstream("/category/status/completed/").then(parseCatalogItems), // FIXED path
  "movies": () => fetchUpstream("/movies/").then(parseCatalogItems), // FIXED: trailing slash
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
    const items = parseCatalogItems(html);
    return items.length ? items[Math.floor(Math.random() * items.length)] : null;
  }, ctx);
}

// FIXED: Use correct upstream paths
async function handleCatalog(kind, ctx, url) {
  const page = Number(url.searchParams.get("page") || 1);
  const pathMap = {
    "series": "/series/",
    "movies": "/movies/",
    "anime": "/category/anime/",
    "cartoon": "/category/cartoon/",
    "ongoing": "/category/status/ongoing/",
    "completed": "/category/status/completed/",
    "fresh-drops": "/", // From homepage
    "popular": "/",
    "popular/series": "/",
    "popular/films": "/",
  };
  const upstreamPath = pathMap[kind] || `/${kind}/`;
  return cached(`cat:${kind}:p${page}`, 21600, async () => {
    try { return { page, data: parseCatalogItems(await fetchUpstream(upstreamPath + (page > 1 ? `page/${page}/` : ""))) }; }
    catch (e) { return { page, data: [], error: e.message }; }
  }, ctx);
}

async function handleTaxonomy(kind, slug, ctx, url) {
  const page = Number(url.searchParams.get("page") || 1);
  return cached(`tax:${kind}:${slug}:p${page}`, 86400, async () => {
    try { return { page, [kind]: slug, data: parseCatalogItems(await fetchUpstream(`/category/${kind}/${slug}/${page > 1 ? `page/${page}/` : ""}`)) }; }
    catch (e) { return { page, [kind]: slug, data: [], error: e.message }; }
  }, ctx);
}

async function handleSearch(ctx, url) {
  const keyword = url.searchParams.get("keyword");
  const page = Number(url.searchParams.get("page") || 1);
  if (!keyword) return jsonError("Missing keyword", 400);
  return cached(`search:${keyword.toLowerCase()}:p${page}`, 300, async () => {
    return { page, data: parseCatalogItems(await fetchUpstream(`/?s=${encodeURIComponent(keyword)}${page > 1 ? `&paged=${page}` : ""}`)) };
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
    return { animeId: id, requestedSeason: season === "all" ? null : Number(season), availableSeasons: r.seasons.map(s => s.num), totalEpisodes: r.episodes.length, failedSeasons: r.failedSeasons, groupedEpisodes: g };
  }, ctx);
}

async function handleServers(ctx, url) {
  const ep = url.searchParams.get("ep");
  if (!ep) return jsonError("Missing ep", 400);
  return cached(`srv:${ep}`, 300, async () => parseServers(await fetchUpstream(`/episode/${ep}/`), ep), ctx);
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
  const embedUrl = server.isMultiLang && lang ? (server.languages.find(l => l.language.toLowerCase() === lang.toLowerCase()) || {}).link || server.embedUrl : server.embedUrl;
  const resolved = /as-cdn/i.test(embedUrl) ? await resolveAsCdn26(embedUrl) : await resolveAbyss(embedUrl);
  const result = { host: server.serverName, serverIndex: serverIdx, selectedLanguage: lang || null, selected_audio: audio || null };
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
  result.subtitles = (resolved.subtitles || []).map(s => ({ label: s.label || "Sub", url: proxyMediaUrl(url.origin, s.url, { referer: s.referer || referer, force: "text/vtt" }) }));
  result.audio_languages = resolved.audio_languages || [];
  result.subtitle_languages = resolved.subtitle_languages || [];
  return jsonSuccess(result, { "Cache-Control": "no-store" });
}

async function handleDiscover(ctx) {
  return cached("discover", 86400, async () => parseTaxonomy(await fetchUpstream("/")), ctx);
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
      if (path === "/api/home/hero") return await handleHomeHero(ctx);
      if (path.startsWith("/api/home/")) return await handleHomeSection(path.replace("/api/home/", ""), ctx);
      if (path === "/api/home") return jsonSuccess({ _deprecated: "Use /api/home/hero + /api/home/<section> in parallel", sections: Object.keys(SECTION_FETCHERS) });
      if (path === "/api/random") return await handleRandom(ctx);
      for (const k of ["series", "movies", "anime", "cartoon", "ongoing", "completed", "fresh-drops", "popular", "popular/series", "popular/films"]) {
        if (path === `/api/${k}`) return await handleCatalog(k, ctx, url);
      }
      if (path === "/api/discover") return await handleDiscover(ctx);
      if (path === "/api/genres") return jsonSuccess(parseTaxonomy(await fetchUpstream("/")).genres);
      for (const kind of ["genre", "language", "country", "type", "year", "network", "franchise", "status"]) {
        const m = path.match(new RegExp(`^/api/${kind}/([^/]+)$`));
        if (m) return await handleTaxonomy(kind, m[1], ctx, url);
      }
      if (path === "/api/search") return await handleSearch(ctx, url);
      if (path === "/api/info") return await handleInfo(ctx, url);
      if (path.startsWith("/api/episodes/")) return await handleEpisodes(decodeURIComponent(path.replace("/api/episodes/", "")), ctx, url);
      if (path === "/api/servers") return await handleServers(ctx, url);
      if (path === "/api/stream") return await handleStream(ctx, url);
      if (path === "/proxy/media") return await handleMediaProxy(request);
      if (path === "/" || path === "") {
        return new Response(`AnimeSalt API v3.40.0-fixed\n\nCorrected upstream paths:\n- /series/ → /series/\n- /movies/ → /movies/\n- /anime/ → /category/anime/\n- /cartoon/ → /category/cartoon/\n- /ongoing/ → /category/status/ongoing/\n- /completed/ → /category/status/completed/\n`, { headers: { "Content-Type": "text/plain" } });
      }
      return jsonError("Not found", 404);
    } catch (e) {
      return jsonError(e.message || "Internal error", 500);
    }
  },
};