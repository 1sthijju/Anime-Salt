import { BASE_URL, CHROME_HEADERS } from './config.js';

const cache = caches.default;

export async function fetchPage(path, query = {}) {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.append(k, v);
  }
  
  const req = new Request(url.toString(), {
    method: "GET",
    headers: CHROME_HEADERS,
    cf: { cacheTtl: 0 } 
  });
  
  const res = await fetch(req, { redirect: "follow" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Upstream HTTP ${res.status}`);
  }
  
  const text = await res.text();
  if (text.includes("cf-challenge") || text.includes("Just a moment...")) {
    throw new Error("Cloudflare Challenge detected");
  }
  return text;
}

export async function cachedJSON(key, fetcher, ttl) {
  const cacheUrl = new URL(`/_cache/${key}`, BASE_URL);
  const cacheReq = new Request(cacheUrl, { headers: { "Cache-Control": "no-cache" } });
  
  let response = await cache.match(cacheReq);
  if (response) {
    return response.json();
  }
  
  const data = await fetcher();
  const jsonText = JSON.stringify(data);
  const cacheRes = new Response(jsonText, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${ttl}`
    }
  });
  
  await cache.put(cacheReq, cacheRes.clone());
  return data;
}

export async function siteAjax(params) {
  const url = new URL("/wp-admin/admin-ajax.php", BASE_URL);
  const body = new URLSearchParams(params).toString();
  
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...CHROME_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": BASE_URL, // Routes referer through the proxy
      "X-Requested-With": "XMLHttpRequest"
    },
    body,
    cf: { cacheTtl: 0 }
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