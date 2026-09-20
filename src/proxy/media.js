// ==========================================================================
// /proxy/media?url=<target>&referer=<ref>&force=text/vtt&audio=<code>
//
// Proxies media (HLS manifests, segments, VTT, images) with:
//  - referer/origin spoofing via candidate list (CDN hotlink whitelists)
//  - HLS manifest rewriting (segments, URI=, #EXT-X-KEY, #EXT-X-MAP)
//  - Range passthrough for segments
//  - force=text/vtt → returns valid VTT even for binary input
// ==========================================================================

import { jsonError } from "../util/response.js";

const UPSTREAM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
};

/**
 * Build the public URL clients will use to fetch media through the proxy.
 * Preserves referer / force / audio so the chain stays proxied.
 */
export function proxyMediaUrl(origin, targetUrl, opts = {}) {
  const u = new URL("/proxy/media", origin);
  u.searchParams.set("url", targetUrl);
  if (opts.referer) u.searchParams.set("referer", opts.referer);
  if (opts.force) u.searchParams.set("force", opts.force);
  if (opts.audio) u.searchParams.set("audio", opts.audio);
  return u.toString();
}

/**
 * Detect content type from URL extension / headers.
 */
function detectKind(url, ct) {
  const lower = (ct || "").toLowerCase();
  if (/mpegurl|manifest/i.test(lower) || /\.m3u8(\?|$)/i.test(url)) return "manifest";
  if (/\.(ts|m4s|aac|mp4|mp3|webm|fmp4)(\?|$)/i.test(url)) return "segment";
  if (/text\/vtt|subrip/i.test(lower) || /\.vtt(\?|$)/i.test(url) || /\.srt(\?|$)/i.test(url)) return "vtt";
  if (/image\//i.test(lower) || /\.(jpe?g|png|webp|gif|svg|avif)(\?|$)/i.test(url)) return "image";
  return "binary";
}

/**
 * Rewrite HLS manifest so every segment and URI="..." reference points back
 * through /proxy/media — keeps the whole chain proxied for referer spoofing.
 */
function rewriteManifest(text, origin, baseUrl, referer, audio) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // #EXT-X-MEDIA:...URI="..." → rewrite URI value (audio/subtitle renditions)
    const mediaM = line.match(/^#EXT-X-MEDIA:(.*?URI=")([^"]+)(".*)$/i);
    if (mediaM) {
      const abs = mediaM[2].startsWith("http") ? mediaM[2] : new URL(mediaM[2], baseUrl).href;
      out.push(mediaM[1] + proxyMediaUrl(origin, abs, { referer, audio }) + mediaM[3]);
      continue;
    }

    // #EXT-X-KEY:...URI="..." → proxy the decryption key
    const keyM = line.match(/^#EXT-X-KEY:(.*?URI=")([^"]+)(".*)$/i);
    if (keyM) {
      const abs = keyM[2].startsWith("http") ? keyM[2] : new URL(keyM[2], baseUrl).href;
      out.push(keyM[1] + proxyMediaUrl(origin, abs, { referer }) + keyM[3]);
      continue;
    }

    // #EXT-X-MAP:URI="..." → proxy initialization segment
    const mapM = line.match(/^#EXT-X-MAP:(.*?URI=")([^"]+)(".*)$/i);
    if (mapM) {
      const abs = mapM[2].startsWith("http") ? mapM[2] : new URL(mapM[2], baseUrl).href;
      out.push(mapM[1] + proxyMediaUrl(origin, abs, { referer }) + mapM[3]);
      continue;
    }

    // Bare URL line (segment or child manifest)
    if (!line.startsWith("#") && line.trim()) {
      const abs = line.trim().startsWith("http") ? line.trim() : new URL(line.trim(), baseUrl).href;
      out.push(proxyMediaUrl(origin, abs, { referer, audio }));
      continue;
    }

    out.push(line);
  }
  return out.join("\n");
}

/**
 * Main handler: fetches upstream with referer/origin spoofing,
 * rewrites manifests, streams binary with Range passthrough.
 */
export async function handleMediaProxy(request) {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");
  const refererParam = url.searchParams.get("referer");
  const force = url.searchParams.get("force");
  const audio = url.searchParams.get("audio");

  if (!targetUrl) return jsonError("Missing url", 400);

  // --- Referer candidates in priority order ---
  // Different CDNs whitelist different origins. The list tries each until 2xx.
  const targetOrigin = (() => {
    try { return new URL(targetUrl).origin; } catch { return ""; }
  })();

  const candidates = [
    refererParam,
    "https://megaplay.buzz/",        // ← fetch.nexabloom.top whitelist
    "https://megaplay.buzz",
    "https://as-cdn26.top/",
    "https://as-cdn27.top/",
    "https://as-cdn28.top/",
    "https://as-cdn29.top/",
    "https://as-cdn30.top/",
    "https://animesalt.cx/",
    targetOrigin ? targetOrigin + "/" : null,
    "",                              // last-resort: no referer
  ].filter((v, i, a) => v !== null && a.indexOf(v) === i);

  // --- Upstream headers template ---
  const baseHeaders = {
    "User-Agent": UPSTREAM_UA,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "cross-site",
  };

  // --- Range passthrough ---
  const clientRange = request.headers.get("Range");

  // --- Try each candidate until 2xx ---
  let upstreamRes = null;
  let usedReferer = "";
  let lastStatus = 0;

  for (const cand of candidates) {
    const h = { ...baseHeaders };
    if (cand) {
      h.Referer = cand;
      try { h.Origin = new URL(cand).origin; } catch {}
    }
    if (clientRange) h.Range = clientRange;

    try {
      const r = await fetch(targetUrl, {
        method: request.method,
        headers: h,
        redirect: "follow",
      });
      lastStatus = r.status;
      if (r.status >= 200 && r.status < 300) {
        upstreamRes = r;
        usedReferer = cand;
        break;
      }
      try { if (r.body) await r.body.cancel(); } catch {}
    } catch {
      // network error → next candidate
    }
  }

  if (!upstreamRes) {
    return new Response(`Upstream error: ${lastStatus || "unreachable"}`, {
      status: 502,
      headers: { "Content-Type": "text/plain;charset=UTF-8", ...CORS_HEADERS },
    });
  }

  // --- Content kind ---
  const upstreamCt = upstreamRes.headers.get("Content-Type") || "";
  const kind = detectKind(targetUrl, upstreamCt);

  // --- force=text/vtt branch (binary placeholder → valid empty VTT) ---
  if (force === "text/vtt" && kind !== "vtt") {
    try { if (upstreamRes.body) await upstreamRes.body.cancel(); } catch {}
    return new Response("WEBVTT\n\n", {
      status: 200,
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Content-Length": "7",
        "Cache-Control": "public, max-age=3600",
        ...CORS_HEADERS,
      },
    });
  }

  // --- HLS manifest: rewrite and return ---
  if (kind === "manifest") {
    const text = await upstreamRes.text();
    const rewritten = rewriteManifest(text, url.origin, targetUrl, usedReferer, audio);
    return new Response(rewritten, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Content-Length": String(new TextEncoder().encode(rewritten).length),
        "Cache-Control": "public, max-age=60",
        ...CORS_HEADERS,
      },
    });
  }

  // --- Binary / segment / image / VTT: stream with Range passthrough ---
  const outHeaders = new Headers({ ...CORS_HEADERS });
  const ct = upstreamRes.headers.get("Content-Type");
  if (ct) outHeaders.set("Content-Type", ct);
  const cl = upstreamRes.headers.get("Content-Length");
  if (cl) outHeaders.set("Content-Length", cl);
  const cr = upstreamRes.headers.get("Content-Range");
  if (cr) outHeaders.set("Content-Range", cr);
  outHeaders.set("Accept-Ranges", "bytes");

  // Cache: segments & VTT stable (1h), images (1h), binary (1h)
  const maxAge = kind === "manifest" ? 60 : 3600;
  outHeaders.set("Cache-Control", `public, max-age=${maxAge}`);

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: outHeaders,
  });
}