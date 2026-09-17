import { BASE_URL, PROXY_BASE, CHROME_HEADERS, AJAX_HEADERS, CACHE_TTL, CACHE_TTL_HOME } from "./config.js";

export async function fetchPage(path, params) {
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

export async function fetchAjax(path) {
  const res = await fetch(`${PROXY_BASE}${path}`, { headers: AJAX_HEADERS });
  return await res.text();
}

export async function cachedJSON(cacheKey, producer, ttl = CACHE_TTL) {
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

export async function getSiteConfig() {
  return await cachedJSON("site:config", async () => {
    const html = await fetchPage("/");
    const nonceMatch = html.match(/"nonce"\s*:\s*"([a-z0-9]+)"/i);
    return { nonce: nonceMatch ? nonceMatch[1] : "" };
  }, CACHE_TTL_HOME);
}

export async function siteAjax(params) {
  const cfg = await getSiteConfig();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  if (cfg.nonce && !qs.has("nonce")) qs.set("nonce", cfg.nonce);
  return await fetchAjax(`/wp-admin/admin-ajax.php?${qs.toString()}`);
}

export async function getSeriesHtml(animeId) {
  return await cachedJSON(`html:series:${animeId}`, () => fetchPage(`/series/${animeId}/`));
}