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

// WordPress admin-ajax: POST must go to the REAL origin first.
// The scrape proxy only reliably serves GET; POSTing through it returns
// HTML/404 and silently kills season loading.
export async function siteAjax(params) {
  const body = new URLSearchParams(params).toString();
  const headers = {
    ...CHROME_HEADERS,
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };

  const attempts = [
    { url: new URL("/wp-admin/admin-ajax.php", ORIGIN_URL), referer: ORIGIN_URL + "/" },
    { url: new URL("/wp-admin/admin-ajax.php", BASE_URL),   referer: BASE_URL + "/" },
  ];

  let lastErr;
  for (const a of attempts) {
    try {
      const res = await fetch(a.url, {
        method: "POST",
        headers: { ...headers, Referer: a.referer, Origin: new URL(a.referer).origin },
        body,
        cf: { cacheTtl: 0 },
      });
      if (!res.ok) { lastErr = new Error(`AJAX HTTP ${res.status}`); continue; }
      const text = await res.text();
      const t = text.trim();
      // WP failure markers or an intercepted HTML page = not a fragment
      if (!t || t === "0" || t === "-1" || t.startsWith("<!DOCTYPE") || t.startsWith("<html")) {
        lastErr = new Error("AJAX non-fragment response");
        continue;
      }
      return text;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("AJAX failed");
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