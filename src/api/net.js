import { BASE_URL, ORIGIN_URL, CHROME_HEADERS } from './config.js';

export async function fetchPage(path, query = {}) {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(query)) url.searchParams.append(k, v);
  
  const req = new Request(url.toString(), { method: "GET", headers: CHROME_HEADERS, cf: { cacheTtl: 0 } });
  const res = await fetch(req, { redirect: "follow" });
  
  if (!res.ok && res.status !== 404) throw new Error(`Upstream HTTP ${res.status}`);
  const text = await res.text();
  
  if (text.includes("cf-challenge") || text.includes("Just a moment...")) throw new Error("CF Challenge");
  return text;
}

export async function cachedJSON(key, fetcher, ttl, ctx) {
  const cache = await caches.open('animesalt-api-v3'); 
  const cacheUrl = new URL(`/_cache/${key}`, BASE_URL);
  const cacheReq = new Request(cacheUrl, { method: 'GET' });
  
  let response = await cache.match(cacheReq);
  if (response) return response.json();
  
  const data = await fetcher();
  const jsonText = JSON.stringify(data);
  const cacheRes = new Response(jsonText, {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` }
  });
  
  if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheReq, cacheRes.clone()));
  else await cache.put(cacheReq, cacheRes.clone());
  
  return data;
}

export async function siteAjax(params) {
  const body = new URLSearchParams(params).toString();
  const headers = {
    ...CHROME_HEADERS,
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest"
  };
  
  // 1. Try proxy first (some proxies drop POST requests or return "0")
  try {
    const proxyUrl = new URL("/wp-admin/admin-ajax.php", BASE_URL);
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { ...headers, "Referer": BASE_URL },
      body, cf: { cacheTtl: 0 }
    });
    if (res.ok) {
      const text = await res.text();
      // WP returns "0" or "-1" for failed actions, or HTML if the proxy intercepts it
      if (text && text.trim() !== "0" && text.trim() !== "-1" && !text.trim().startsWith("<!DOCTYPE")) return text;
    }
  } catch(e) { /* fallthrough to origin */ }
  
  // 2. Fallback to origin directly for AJAX
  const originUrl = new URL("/wp-admin/admin-ajax.php", ORIGIN_URL);
  const res = await fetch(originUrl, {
    method: "POST",
    headers: { ...headers, "Referer": ORIGIN_URL },
    body, cf: { cacheTtl: 0 }
  });
  if (!res.ok) throw new Error(`AJAX HTTP ${res.status}`);
  return res.text();
}

export async function getSeriesHtml(id) {
  try {
    const html = await fetchPage(`/series/${id}/`);
    if (html.includes("404 Not Found")) {
      const movieHtml = await fetchPage(`/movies/${id}/`);
      if (movieHtml.includes("404 Not Found")) throw new Error("Not Found");
      return { html: movieHtml, type: "movies" };
    }
    return { html, type: "series" };
  } catch (e) {
    const movieHtml = await fetchPage(`/movies/${id}/`);
    if (movieHtml.includes("404 Not Found")) throw new Error("Not Found");
    return { html: movieHtml, type: "movies" };
  }
}