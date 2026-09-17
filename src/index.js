// ============================================================================
// ANIMESALT EDGE API v3.2.0 — Zero-dependency Cloudflare Worker
// Architecture:
//   - Native fetch + Regex parsing (no Cheerio/Express/Hono)
//   - WAF bypass via reverse proxy fallback (animesalt-proxy.v1nx.workers.dev)
//   - Edge caching (Cache API) for pages, seasons, and site config
//   - Site-native AJAX layer (admin-ajax.php) with PARALLEL season fetching
//   - Stream decryptors: as-cdn26.top (token AJAX) + Abyss (AES-CTR + Sora)
//   - /proxy/media: CORS + Referer injection + HLS manifest rewriting
//   - Abyss URL normalization: short.icu/short.ink → abyssplayer.com
// ============================================================================

const BASE_URL = "https://animesalt.cx";
const PROXY_BASE = "https://animesalt-proxy.v1nx.workers.dev";
const CACHE_TTL = 6 * 60 * 60;       // 6 hours default
const CACHE_TTL_HOME = 30 * 60;      // 30 minutes for homepage feeds

const CHROME_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://animesalt.cx/",
  "sec-ch-ua": '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const AJAX_HEADERS = {
  ...CHROME_HEADERS,
  "Accept": "*/*",
  "X-Requested-With": "XMLHttpRequest",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// ============================================================================
// 1. CRYPTO UTILITIES (MD5 Polyfill + Web Crypto AES-CTR)
// ============================================================================
function md5(string) {
  function rotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); }
  function addUnsigned(lX, lY) {
    let lX4, lY4, lX8, lY8, lResult;
    lX8 = (lX & 0x80000000); lY8 = (lY & 0x80000000);
    lX4 = (lX & 0x40000000); lY4 = (lY & 0x40000000);
    lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
    if (lX4 & lY4) return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
    if (lX4 | lY4) {
      if (lX4 & lY4) return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
      else return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
    } else return (lResult ^ lX8 ^ lY8);
  }
  function f(x, y, z) { return (x & y) | ((~x) & z); }
  function g(x, y, z) { return (x & z) | (y & (~z)); }
  function h(x, y, z) { return (x ^ y ^ z); }
  function i(x, y, z) { return (y ^ (x | (~z))); }
  function ff(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(f(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
  function gg(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(g(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
  function hh(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(h(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
  function ii(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(i(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
  function convertToWordArray(str) {
    let lWordCount, lMessageLength = str.length, lNumberOfWords_temp1 = lMessageLength + 8;
    let lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
    let lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16, lWordArray = Array(lNumberOfWords - 1);
    let lBytePosition = 0, lByteCount = 0;
    while (lByteCount < lMessageLength) {
      lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] = (lWordArray[lWordCount] | (str.charCodeAt(lByteCount) << lBytePosition)); lByteCount++;
    }
    lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3; lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }
  function wordToHex(lValue) {
    let wordToHexValue = "", wordToHexValue_temp = "", lByte, lCount;
    for (lCount = 0; lCount <= 3; lCount++) {
      lByte = (lValue >>> (lCount * 8)) & 255; wordToHexValue_temp = "0" + lByte.toString(16);
      wordToHexValue = wordToHexValue + wordToHexValue_temp.substr(wordToHexValue_temp.length - 2, 2);
    }
    return wordToHexValue;
  }
  let x = [], k, AA, BB, CC, DD, a, b, c, d;
  const S11 = 7, S12 = 12, S13 = 17, S14 = 22, S21 = 5, S22 = 9, S23 = 14, S24 = 20, S31 = 4, S32 = 11, S33 = 16, S34 = 23, S41 = 6, S42 = 10, S43 = 15, S44 = 21;
  string = unescape(encodeURIComponent(string)); x = convertToWordArray(string);
  a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476;
  for (k = 0; k < x.length; k += 16) {
    AA = a; BB = b; CC = c; DD = d;
    a = ff(a, b, c, d, x[k + 0], S11, 0xD76AA478); d = ff(d, a, b, c, x[k + 1], S12, 0xE8C7B756); c = ff(c, d, a, b, x[k + 2], S13, 0x242070DB); b = ff(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
    a = ff(a, b, c, d, x[k + 4], S11, 0xF57C0FAF); d = ff(d, a, b, c, x[k + 5], S12, 0x4787C62A); c = ff(c, d, a, b, x[k + 6], S13, 0xA8304613); b = ff(b, c, d, a, x[k + 7], S14, 0xFD469501);
    a = ff(a, b, c, d, x[k + 8], S11, 0x698098D8); d = ff(d, a, b, c, x[k + 9], S12, 0x8B44F7AF); c = ff(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1); b = ff(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
    a = ff(a, b, c, d, x[k + 12], S11, 0x6B901122); d = ff(d, a, b, c, x[k + 13], S12, 0xFD987193); c = ff(c, d, a, b, x[k + 14], S13, 0xA679438E); b = ff(b, c, d, a, x[k + 15], S14, 0x49B40821);
    a = gg(a, b, c, d, x[k + 1], S21, 0xF61E2562); d = gg(d, a, b, c, x[k + 6], S22, 0xC040B340); c = gg(c, d, a, b, x[k + 11], S23, 0x265E5A51); b = gg(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
    a = gg(a, b, c, d, x[k + 5], S21, 0xD62F105D); d = gg(d, a, b, c, x[k + 10], S22, 0x2441453); c = gg(c, d, a, b, x[k + 15], S23, 0xD8A1E681); b = gg(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
    a = gg(a, b, c, d, x[k + 9], S21, 0x21E1CDE6); d = gg(d, a, b, c, x[k + 14], S22, 0xC33707D6); c = gg(c, d, a, b, x[k + 3], S23, 0xF4D50D87); b = gg(b, c, d, a, x[k + 8], S24, 0x455A14ED);
    a = gg(a, b, c, d, x[k + 13], S21, 0xA9E3E905); d = gg(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8); c = gg(c, d, a, b, x[k + 7], S23, 0x676F02D9); b = gg(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
    a = hh(a, b, c, d, x[k + 5], S31, 0xFFFA3942); d = hh(d, a, b, c, x[k + 8], S32, 0x8771F681); c = hh(c, d, a, b, x[k + 11], S33, 0x6D9D6122); b = hh(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
    a = hh(a, b, c, d, x[k + 1], S31, 0xA4BEEA44); d = hh(d, a, b, c, x[k + 4], S32, 0x4BDECFA9); c = hh(c, d, a, b, x[k + 7], S33, 0xF6BB4B60); b = hh(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
    a = hh(a, b, c, d, x[k + 13], S31, 0x289B7EC6); d = hh(d, a, b, c, x[k + 0], S32, 0xEAA127FA); c = hh(c, d, a, b, x[k + 3], S33, 0xD4EF3085); b = hh(b, c, d, a, x[k + 6], S34, 0x4881D05);
    a = hh(a, b, c, d, x[k + 9], S31, 0xD9D4D039); d = hh(d, a, b, c, x[k + 12], S32, 0xE6DB99E5); c = hh(c, d, a, b, x[k + 15], S33, 0x1FA27CF8); b = hh(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
    a = ii(a, b, c, d, x[k + 0], S41, 0xF4292244); d = ii(d, a, b, c, x[k + 7], S42, 0x432AFF97); c = ii(c, d, a, b, x[k + 14], S43, 0xAB9423A7); b = ii(b, c, d, a, x[k + 5], S44, 0xFC93A039);
    a = ii(a, b, c, d, x[k + 12], S41, 0x655B59C3); d = ii(d, a, b, c, x[k + 3], S42, 0x8F0CCC92); c = ii(c, d, a, b, x[k + 10], S43, 0xFFEFF47D); b = ii(b, c, d, a, x[k + 1], S44, 0x85845DD1);
    a = ii(a, b, c, d, x[k + 8], S41, 0x6FA87E4F); d = ii(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0); c = ii(c, d, a, b, x[k + 6], S43, 0xA3014314); b = ii(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
    a = ii(a, b, c, d, x[k + 4], S41, 0xF7537E82); d = ii(d, a, b, c, x[k + 11], S42, 0xBD3AF235); c = ii(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB); b = ii(b, c, d, a, x[k + 9], S44, 0xEB86D391);
    a = addUnsigned(a, AA); b = addUnsigned(b, BB); c = addUnsigned(c, CC); d = addUnsigned(d, DD);
  }
  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

async function aesCtrTransform(data, keySeed, mode) {
  const keyHex = md5(keySeed);
  const keyBytes = new TextEncoder().encode(keyHex);
  const iv = keyBytes.slice(0, 16);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CTR" }, false, [mode]);
  const result = await crypto.subtle[mode]({ name: "AES-CTR", counter: iv, length: 64 }, cryptoKey, data);
  return new Uint8Array(result);
}

// ============================================================================
// 2. NETWORK HELPERS (WAF bypass + Edge cache + Site-native AJAX)
// ============================================================================
async function fetchPage(path, params) {
  let fullUrl = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  if (params) {
    const urlObj = new URL(fullUrl);
    for (const [k, v] of Object.entries(params)) { if (v) urlObj.searchParams.set(k, v); }
    fullUrl = urlObj.toString();
  }
  let res = await fetch(fullUrl, { headers: CHROME_HEADERS });
  let text = await res.text();
  const challenged = !res.ok || text.includes("Just a moment...") || text.includes("cf-browser-verification");
  if (challenged) {
    const u = new URL(fullUrl);
    if (u.hostname.endsWith("animesalt.cx")) {
      res = await fetch(`${PROXY_BASE}${u.pathname}${u.search}`, { headers: CHROME_HEADERS });
      text = await res.text();
    }
  }
  return text;
}

async function fetchAjax(path) {
  const res = await fetch(`${PROXY_BASE}${path}`, { headers: AJAX_HEADERS });
  return await res.text();
}

async function cachedJSON(cacheKey, producer, ttl = CACHE_TTL) {
  const cache = caches.default;
  const key = new Request(`https://edge-cache.internal/${encodeURIComponent(cacheKey)}`);
  try {
    const hit = await cache.match(key);
    if (hit) return await hit.json();
  } catch (e) {}
  const data = await producer();
  try {
    const resp = new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` },
    });
    await cache.put(key, resp.clone());
  } catch (e) {}
  return data;
}

async function getSiteConfig() {
  return await cachedJSON("site:config", async () => {
    const html = await fetchPage("/");
    const nonceMatch = html.match(/"nonce"\s*:\s*"([a-z0-9]+)"/i);
    return { nonce: nonceMatch ? nonceMatch[1] : "" };
  }, CACHE_TTL_HOME);
}

async function siteAjax(params) {
  const cfg = await getSiteConfig();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  if (cfg.nonce && !qs.has("nonce")) qs.set("nonce", cfg.nonce);
  return await fetchAjax(`/wp-admin/admin-ajax.php?${qs.toString()}`);
}

async function getSeriesHtml(animeId) {
  return await cachedJSON(`html:series:${animeId}`, () => fetchPage(`/series/${animeId}/`));
}

// ============================================================================
// 3. URL NORMALIZERS + STREAM DECRYPTORS
// ============================================================================

// Rewrite legacy Abyss redirectors (short.icu / short.ink / etc.) to abyssplayer.com/{slug}
function normalizeAbyssUrl(url) {
  try {
    const u = new URL(url);
    const legacyHosts = ["short.icu", "short.ink", "abysscdn.com", "hydraxcdn.biz", "embedplayabyss.top"];
    if (legacyHosts.includes(u.hostname)) {
      const slug = u.pathname.split("/").filter(Boolean).pop() || u.searchParams.get("v") || "";
      if (slug) return `https://abyssplayer.com/${slug}`;
    }
    return url;
  } catch (e) { return url; }
}

async function resolveAsCdn26(embedUrl) {
  const videoId = new URL(embedUrl).pathname.split('/').pop();
  const sessionRes = await fetch(embedUrl, { headers: CHROME_HEADERS });
  let cookie = "";
  const setCookies = sessionRes.headers.getSetCookie?.() || [];
  for (const c of setCookies) {
    const match = c.match(/fireplayer_player=([^;]+)/);
    if (match) { cookie = `fireplayer_player=${match[1]}`; break; }
  }
  const ajaxRes = await fetch(`https://as-cdn26.top/player/index.php?data=${videoId}&do=getVideo`, {
    method: 'POST',
    headers: { ...AJAX_HEADERS, "Cookie": cookie, "Referer": embedUrl, "Origin": "https://as-cdn26.top", "Content-Type": "application/x-www-form-urlencoded" },
    body: `hash=${videoId}&r=https://animesalt.cx/`
  });
  const data = await ajaxRes.json();
  if (!data.securedLink) throw new Error("Failed to get as-cdn26 token");
  return { host: "as-cdn26.top", source_type: "hls", direct_hls: data.securedLink, subtitles: data.tracks || [] };
}

async function resolveAbyss(embedUrl) {
  embedUrl = normalizeAbyssUrl(embedUrl);
  const html = await fetchPage(embedUrl);
  const datasMatch = html.match(/(?:const|var)\s+datas\s*=\s*"([^"]+)"/);
  if (!datasMatch) throw new Error("No Abyss payload");
  const rawBytes = Uint8Array.from(atob(datasMatch[1]), c => c.charCodeAt(0));
  const payload = JSON.parse(new TextDecoder().decode(rawBytes));
  const seed = `${payload.user_id}:${payload.slug}:${payload.md5_id}`;
  const mediaBytes = Uint8Array.from(payload.media, c => c.charCodeAt(0));
  const decrypted = await aesCtrTransform(mediaBytes, seed, 'decrypt');
  const mediaJson = JSON.parse(new TextDecoder().decode(decrypted));
  const qualities = [];
  const sources = mediaJson.mp4?.sources || [];
  for (const src of sources) {
    if (src.file) {
      qualities.push({ resolution: src.label || "Unknown", url: src.file });
    } else if (src.path && src.size && src.sub) {
      const pathBytes = new TextEncoder().encode(`/mp4/${payload.md5_id}/${src.res_id}/${src.size}?v=${payload.slug}`);
      const encPath = await aesCtrTransform(pathBytes, src.size.toString(), 'encrypt');
      const soraToken = btoa(btoa(String.fromCharCode(...encPath)));
      const domain = mediaJson.mp4.domains?.find(d => src.sub.includes(d)) || "abysscdn.com";
      qualities.push({ resolution: src.label, size: src.size, url: `https://${domain}/sora/${src.size}/${soraToken}` });
    }
  }
  return { host: "abyssplayer.com", source_type: "mp4", qualities };
}

// ============================================================================
// 4. REGEX PARSERS
// ============================================================================
function extractAnimeList(html) {
  const results = [];
  const articleRegex = /<article[^>]*class="[^"]*post[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = articleRegex.exec(html)) !== null) {
    const h = match[1];
    const urlMatch = h.match(/href="([^"]+\/(?:series|movies|anime)\/[^"]+)"/i);
    const url = urlMatch ? urlMatch[1] : "";
    const slugMatch = url.match(/\/(?:series|movies|anime)\/([^/]+)\/?$/);
    const id = slugMatch ? slugMatch[1] : "";
    if (!id) continue;
    const titleMatch = h.match(/class="[^"]*(?:entry-title|title)[^"]*"[^>]*>([^<]+)/i) || h.match(/alt="([^"]+)"/i);
    const title = titleMatch ? titleMatch[1].trim() : "";
    const imgMatch = h.match(/data-src="([^"]+)"/i) || h.match(/src="([^"]+)"/i);
    let image = imgMatch ? imgMatch[1] : "";
    if (image.startsWith("//")) image = "https:" + image;
    results.push({ id, title, image, type: url.includes("/movies/") ? "movie" : "series", url });
  }
  return results;
}

function extractPopularItems(html, targetType) {
  const results = [];
  const chartRegex = /<div[^>]*class="[^"]*chart-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let match;
  while ((match = chartRegex.exec(html)) !== null) {
    const itemHtml = match[1];
    const rankMatch = itemHtml.match(/class="[^"]*chart-number[^"]*"[^>]*>(\d+)/i);
    const rank = rankMatch ? parseInt(rankMatch[1]) : null;
    const linkMatch = itemHtml.match(/href="([^"]+\/(?:series|movies|anime)\/[^"]+)"/i);
    const url = linkMatch ? linkMatch[1] : "";
    const slugMatch = url.match(/\/(?:series|movies|anime)\/([^/]+)\/?$/);
    const id = slugMatch ? slugMatch[1] : "";
    if (!id) continue;
    const type = slugMatch && slugMatch[1] === "movies" ? "movie" : "series";
    if (targetType && type !== targetType) continue;
    const titleMatch = itemHtml.match(/class="[^"]*chart-title[^"]*"[^>]*>([^<]+)/i) || itemHtml.match(/alt="([^"]+)"/i);
    const title = titleMatch ? titleMatch[1].trim() : "";
    const imgMatch = itemHtml.match(/data-src="([^"]+)"/i) || itemHtml.match(/src="([^"]+)"/i);
    let image = imgMatch ? imgMatch[1] : "";
    if (image.startsWith("//")) image = "https:" + image;
    if (!results.find(r => r.id === id)) results.push({ rank, id, title, image, type, url });
  }
  return results;
}

function parseEpisodesFromHtml(html, seasonNum) {
  const eps = [];
  const epRegex = /<a[^>]+href="([^"]+\/episode\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = epRegex.exec(html)) !== null) {
    const url = match[1];
    const slugMatch = url.match(/\/episode\/([^/]+)\/?$/);
    const epSlug = slugMatch ? slugMatch[1] : "";
    if (!epSlug) continue;
    const sxe = epSlug.match(/(\d+)x(\d+)$/);
    const sNum = sxe ? parseInt(sxe[1]) : seasonNum;
    const epNum = sxe ? parseInt(sxe[2]) : 0;
    if (epNum === 0) continue;
    const titleMatch = match[2].match(/class="[^"]*(?:entry-title|title)[^"]*"[^>]*>([^<]+)/i) || match[2].match(/>([^<]+)</i);
    const title = titleMatch ? titleMatch[1].trim().replace(/^\d+\s*/, "").replace(/\s*View\s*$/i, "").trim() : `Episode ${epNum}`;
    if (!eps.find(e => e.slug === epSlug)) eps.push({ num: epNum, season: sNum, title, slug: epSlug, url });
  }
  return eps;
}

// ============================================================================
// 5. EPISODE ENGINE (Site-native AJAX + PARALLEL + Cached + Self-healing)
// ============================================================================
async function getEpisodesData(animeId, requestedSeason) {
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

// ============================================================================
// 6. MEDIA PROXY (CORS fix + Referer injection + HLS manifest rewriting)
// ============================================================================
function proxyMediaUrl(workerOrigin, absoluteUrl) {
  return `${workerOrigin}/proxy/media?url=${encodeURIComponent(absoluteUrl)}`;
}

function rewriteManifest(text, manifestUrl, workerOrigin) {
  const base = new URL(manifestUrl);
  return text.split("\n").map(line => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_m, uri) =>
        `URI="${proxyMediaUrl(workerOrigin, new URL(uri, base).href)}"`);
    }
    return proxyMediaUrl(workerOrigin, new URL(t, base).href);
  }).join("\n");
}

// ============================================================================
// 7. NATIVE ROUTER
// ============================================================================
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
          version: "3.2.0",
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
        return jsonResponse({ success: upstreamOnline, status: upstreamOnline ? "healthy" : "degraded", timestamp: new Date().toISOString(), upstream: { source: BASE_URL, online: upstreamOnline, latencyMs: upstreamLatency, error: upstreamError }, version: "3.2.0-edge", endpointsCount: 14 });
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
          const containerRegex = new RegExp(`<div[^>]*id="options-${index}"[^>]*>([\\s\\S]*?)<\\/div>\\s*(?=<div[^>]*id="options-|$)`, 'i');
          const containerMatch = data.match(containerRegex);
          const containerHtml = containerMatch ? containerMatch[1] : "";
          const iframeMatch = containerHtml.match(/<iframe[^>]*(?:src|data-src)="([^"]+)"/i);
          const embedUrl = iframeMatch ? iframeMatch[1] : "";
          let languages = [];
          if (embedUrl.includes("multi-lang-plyr/player.php?data=")) {
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

      if (path === "/api/stream") {
        const epSlug = params.get("ep");
        const serverParam = params.get("server") || "0";
        const lang = params.get("lang");
        if (!epSlug) return jsonResponse({ success: false, error: "Episode slug (ep) is required" }, 400);
        const data = await cachedJSON(`html:episode:${epSlug}`, () => fetchPage(`/episode/${epSlug}/`));
        const serverIndex = parseInt(serverParam, 10);
        const containerRegex = new RegExp(`<div[^>]*id="options-${serverIndex}"[^>]*>([\\s\\S]*?)<\\/div>\\s*(?=<div[^>]*id="options-|$)`, 'i');
        const containerMatch = data.match(containerRegex);
        const containerHtml = containerMatch ? containerMatch[1] : data;
        const iframeMatch = containerHtml.match(/<iframe[^>]*(?:src|data-src)="([^"]+)"/i);
        let embedUrl = iframeMatch ? iframeMatch[1] : null;
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
            if (embedUrl.includes("as-cdn26.top")) resolvedStream = await resolveAsCdn26(embedUrl);
            else if (/(short\.icu|short\.ink|abysscdn\.com|hydraxcdn\.biz|embedplayabyss\.top|abyssplayer\.com)/.test(embedUrl)) {
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
        else return jsonResponse({ success: true, data: { embedUrl, serverIndex, selectedLanguage, isIframe: true, referer: `${BASE_URL}/episode/${epSlug}/` } });
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
        const target = params.get("url");
        if (!target) return jsonResponse({ error: "url required" }, 400);
        let u;
        try { u = new URL(target); } catch { return jsonResponse({ error: "bad url" }, 400); }

        const upstreamHeaders = {
          "User-Agent": CHROME_HEADERS["User-Agent"],
          "Referer": `${u.origin}/`,
          "Origin": u.origin,
          "Accept": "*/*",
        };
        const range = request.headers.get("Range");
        if (range) upstreamHeaders["Range"] = range;

        const res = await fetch(target, { headers: upstreamHeaders, redirect: "follow" });
        if (!res.ok && res.status !== 206) {
          return new Response(`Upstream returned ${res.status}`, { status: 502, headers: corsHeaders });
        }

        const ctype = (res.headers.get("Content-Type") || "").toLowerCase();
        const isManifest = ctype.includes("mpegurl") || ctype.includes("m3u8") || u.pathname.endsWith(".m3u8");

        const headers = new Headers(corsHeaders);
        headers.set("Accept-Ranges", "bytes");
        const cr = res.headers.get("Content-Range"); if (cr) headers.set("Content-Range", cr);
        const cl = res.headers.get("Content-Length"); if (cl) headers.set("Content-Length", cl);

        if (isManifest) {
          const text = await res.text();
          const rewritten = rewriteManifest(text, target, new URL(request.url).origin);
          headers.set("Content-Type", "application/vnd.apple.mpegurl");
          headers.set("Cache-Control", "public, max-age=300");
          return new Response(rewritten, { status: res.status, headers });
        }

        headers.set("Content-Type", ctype || "application/octet-stream");
        headers.set("Cache-Control",
          (u.pathname.endsWith(".ts") || u.pathname.endsWith(".m4s"))
            ? "public, max-age=86400"
            : "public, max-age=3600");
        return new Response(res.body, { status: res.status, headers });
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (e) {
      return jsonResponse({ error: e.message, stack: e.stack }, 500);
    }
  }
};