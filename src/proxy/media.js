// ==========================================================================
// Media proxy — rewrites HLS manifests + proxies VTT with referer
// ==========================================================================

import { CHROME_HEADERS, corsHeaders } from "../config.js";

/**
 * Build a proxied media URL
 */
export function proxyMediaUrl(workerOrigin, url, params = {}) {
  const u = new URL("/proxy/media", workerOrigin);
  u.searchParams.set("url", url);
  for (const [k, v] of Object.entries(params)) {
    if (v) u.searchParams.set(k, v);
  }
  return u.toString();
}

/**
 * Handle /proxy/media requests
 * Proxies HLS segments, VTT subtitles, and media files with proper referer
 */
export async function handleMediaProxy(request) {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");
  let referer = url.searchParams.get("referer");
  const forceType = url.searchParams.get("force");

  if (!targetUrl) {
    return new Response("Missing url", { status: 400, headers: corsHeaders });
  }
  if (!referer) {
    try {
      referer = new URL(targetUrl).origin + "/";
    } catch {
      referer = "";
    }
  }

  // Try multiple referer candidates
  const candidates = [
    referer,
    "",
    new URL(targetUrl).origin + "/",
    "https://as-cdn26.top/",
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let res, lastStatus;
  for (const r of candidates) {
    const h = new Headers({
      "User-Agent": CHROME_HEADERS["User-Agent"],
      Accept: "*/*",
    });
    if (r) {
      h.set("Referer", r);
      try {
        h.set("Origin", new URL(r).origin);
      } catch {}
    }
    const rng = request.headers.get("Range");
    if (rng) h.set("Range", rng);
    try {
      res = await fetch(targetUrl, { headers: h, redirect: "follow" });
    } catch {
      continue;
    }
    if (res.ok) break;
    lastStatus = res.status;
    try {
      if (res.body) await res.body.cancel();
    } catch {}
    if (lastStatus !== 403 && lastStatus !== 404) break;
  }

  if (!res || !res.ok) {
    // Return empty VTT if forcing text/vtt
    if (forceType === "text/vtt") {
      return new Response("WEBVTT\n\n", {
        headers: {
          "Content-Type": "text/vtt",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
    return new Response(`Upstream error: ${lastStatus || "unknown"}`, {
      status: 502,
      headers: corsHeaders,
    });
  }

  const ct = (res.headers.get("Content-Type") || "").toLowerCase();

  // Force text/vtt for subtitles
  if (forceType === "text/vtt") {
    const text = await res.text();
    // Detect if it's actually an image (binary)
    const isImage = /^\u00FF\u00D8\u00FF|\u0089PNG|GIF8|RIFF/.test(text);
    if (isImage) {
      return new Response("WEBVTT\n\n", {
        headers: {
          "Content-Type": "text/vtt",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
    const vtt = text.trimStart().startsWith("WEBVTT")
      ? text
      : "WEBVTT\n\n" + text.replace(/\r\n/g, "\n");
    return new Response(vtt, {
      headers: {
        "Content-Type": "text/vtt",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  const reader = res.body.getReader();
  const first = await reader.read();
  const headText = first.value
    ? new TextDecoder().decode(first.value.subarray(0, 64))
    : "";

  // Check if it's an HLS manifest
  if (!first.done && headText.trimStart().startsWith("#EXTM3U")) {
    let text = new TextDecoder().decode(first.value);
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      text += new TextDecoder().decode(r.value);
    }
    const lines = text.split(/\r?\n/);
    const out = lines.map((line) => {
      if (!line.trim()) return line;
      // Rewrite segment URLs
      if (!line.startsWith("#")) {
        try {
          return proxyMediaUrl(
            url.origin,
            new URL(line.trim(), targetUrl).toString(),
            { referer }
          );
        } catch {
          return line;
        }
      }
      // Rewrite URI= in #EXT-X-KEY etc.
      return line.replace(/URI="([^"]+)"/g, (_, uri) => {
        try {
          return `URI="${proxyMediaUrl(
            url.origin,
            new URL(uri, targetUrl).toString(),
            { referer }
          )}"`;
        } catch {
          return `URI="${uri}"`;
        }
      });
    });
    return new Response(out.join("\n"), {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  // Stream binary data (video segments, images, etc.)
  const stream = new ReadableStream({
    async start(c) {
      if (first.value) c.enqueue(first.value);
    },
    async pull(c) {
      const r = await reader.read();
      r.done ? c.close() : c.enqueue(r.value);
    },
  });
  const rh = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Content-Type": ct || "application/octet-stream",
    "Cache-Control": "public, max-age=3600",
  });
  ["Content-Range", "Content-Length"].forEach((h) => {
    if (res.headers.has(h)) rh.set(h, res.headers.get(h));
  });
  return new Response(stream, { status: res.status, headers: rh });
}