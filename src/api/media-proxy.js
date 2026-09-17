import { CHROME_HEADERS, corsHeaders, jsonResponse } from "./config.js";

export function proxyMediaUrl(workerOrigin, absoluteUrl) {
  return `${workerOrigin}/proxy/media?url=${encodeURIComponent(absoluteUrl)}`;
}

export function rewriteManifest(text, manifestUrl, workerOrigin) {
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

export async function handleMediaProxy(request) {
  const params = new URL(request.url).searchParams;
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