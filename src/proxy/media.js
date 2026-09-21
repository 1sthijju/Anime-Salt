// ==========================================================================
// /proxy/media?url=<target>&referer=<ref>&force=text/vtt&audio=<code>
//
// Proxies media (HLS manifests, MP4, segments, VTT, images) with:
//  - referer spoofing via candidate list; PAGE-LEVEL referer tried first
//    (sssrr.org / hydrax-family CDNs gate on the player-page URL)
//  - Origin header sent ONLY for origin-level referers (browsers omit Origin
//    on plain media loads; some CDNs 403 when it's present)
//  - HLS manifest rewriting (segments, URI=, #EXT-X-KEY, #EXT-X-MAP,
//    #EXT-X-MEDIA) — tag prefixes preserved (v4 fix)
//  - Audio selection via ?audio=<code> → flips DEFAULT flag (v5 fix)
//  - Range passthrough for MP4/segments
//  - force=text/vtt → valid VTT even when upstream serves a binary placeholder
//  - HTML challenge/block pages are rejected with 502 instead of being
//    streamed to the player as "video"
// ==========================================================================

import { jsonError } from "../util/response.js";

const UPSTREAM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
};

// ---------- audio language normalization ----------
const NAME2CODE = {
  japanese: "jpn", english: "eng", hindi: "hin", tamil: "tam", telugu: "tel",
  spanish: "spa", french: "fre", german: "ger", italian: "ita",
  portuguese: "por", russian: "rus", korean: "kor", chinese: "chi", arabic: "ara",
};
const TWO2THREE = {
  ja: "jpn", en: "eng", hi: "hin", ta: "tam", te: "tel", es: "spa", fr: "fre",
  de: "ger", it: "ita", pt: "por", ru: "rus", ko: "kor", zh: "chi", ar: "ara",
};
function normAudio(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "";
  if (NAME2CODE[s]) return NAME2CODE[s];
  if (TWO2THREE[s]) return TWO2THREE[s];
  return s.slice(0, 3);
}

/**
 * Public URL clients use to fetch media through this proxy.
 * Preserves referer / force / audio so the whole chain stays proxied.
 */
export function proxyMediaUrl(origin, targetUrl, opts = {}) {
  const u = new URL("/proxy/media", origin);
  u.searchParams.set("url", targetUrl);
  if (opts.referer) u.searchParams.set("referer", opts.referer);
  if (opts.force) u.searchParams.set("force", opts.force);
  if (opts.audio) u.searchParams.set("audio", opts.audio);
  return u.toString();
}

/** Detect content kind from URL extension / content-type. */
function detectKind(url, ct) {
  const lower = (ct || "").toLowerCase();
  if (/mpegurl|manifest/i.test(lower) || /\.m3u8(\?|$)/i.test(url)) return "manifest";
  if (/\.(ts|m4s|aac|mp4|mp3|webm|fmp4)(\?|$)/i.test(url)) return "segment";
  if (/text\/vtt|subrip/i.test(lower) || /\.vtt(\?|$)/i.test(url) || /\.srt(\?|$)/i.test(url)) return "vtt";
  if (/image\//i.test(lower) || /\.(jpe?g|png|webp|gif|svg|avif)(\?|$)/i.test(url)) return "image";
  return "binary";
}

/**
 * Rewrite an HLS manifest:
 *  - proxy every segment / URI= / #EXT-X-KEY / #EXT-X-MAP / #EXT-X-MEDIA
 *  - when ?audio=<code> is present, flip DEFAULT=YES on the matching AUDIO
 *    rendition (all others DEFAULT=NO) so any engine auto-selects it
 * Tag prefixes are preserved (v4 fix).
 */
function rewriteManifest(text, origin, baseUrl, referer, audio) {
  const want = audio ? normAudio(audio) : null;
  const lines = text.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // --- AUDIO DEFAULT flip when ?audio= present ---
    if (want && /^#EXT-X-MEDIA:/i.test(line) && /TYPE=AUDIO/i.test(line)) {
      const langM = line.match(/LANGUAGE="([^"]+)"/i);
      const nameM = line.match(/NAME="([^"]+)"/i);
      const hit = (langM && normAudio(langM[1]) === want) ||
                  (nameM && normAudio(nameM[1]) === want);
      line = line.replace(/DEFAULT=(YES|NO)/i, `DEFAULT=${hit ? "YES" : "NO"}`);
    }

    // --- #EXT-X-MEDIA:URI="..." (audio / subtitle renditions) ---
    const mediaM = line.match(/^(#EXT-X-MEDIA:.*?URI=")([^"]+)(".*)$/i);
    if (mediaM) {
      const abs = mediaM[2].startsWith("http") ? mediaM[2] : new URL(mediaM[2], baseUrl).href;
      out.push(mediaM[1] + proxyMediaUrl(origin, abs, { referer, audio }) + mediaM[3]);
      continue;
    }

    // --- #EXT-X-KEY:URI="..." (encryption key) ---
    const keyM = line.match(/^(#EXT-X-KEY:.*?URI=")([^"]+)(".*)$/i);
    if (keyM) {
      const abs = keyM[2].startsWith("http") ? keyM[2] : new URL(keyM[2], baseUrl).href;
      out.push(keyM[1] + proxyMediaUrl(origin, abs, { referer }) + keyM[3]);
      continue;
    }

    // --- #EXT-X-MAP:URI="..." (init segment) ---
    const mapM = line.match(/^(#EXT-X-MAP:.*?URI=")([^"]+)(".*)$/i);
    if (mapM) {
      const abs = mapM[2].startsWith("http") ? mapM[2] : new URL(mapM[2], baseUrl).href;
      out.push(mapM[1] + proxyMediaUrl(origin, abs, { referer }) + mapM[3]);
      continue;
    }

    // --- bare URL line (segment / child manifest) ---
    if (!line.startsWith("#") && line.trim()) {
      const abs = line.trim().startsWith("http") ? line.trim() : new URL(line.trim(), baseUrl).href;
      out.push(proxyMediaUrl(origin, abs, { referer, audio }));
      continue;
    }

    out.push(line);
  }
  return out.join("\n");
}

/** Main handler. */
export async function handleMediaProxy(request) {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");
  const refererParam = url.searchParams.get("referer");
  const force = url.searchParams.get("force");
  const audio = url.searchParams.get("audio");

  if (!targetUrl) return jsonError("Missing url", 400);

  // --- referer candidates: PAGE-LEVEL first, then its origin, then known hosts ---
  const targetOrigin = (() => { try { return new URL(targetUrl).origin; } catch { return ""; } })();
  const refererOrigin = (() => { try { return new URL(refererParam).origin + "/"; } catch { return null; } })();

  const candidates = [
    refererParam,                      // e.g. https://player.abyssplayer.com/<slug>
    refererOrigin,                     // https://player.abyssplayer.com/
    "https://megaplay.buzz/",
    "https://megaplay.buzz",
    "https://as-cdn26.top/",
    "https://as-cdn27.top/",
    "https://as-cdn28.top/",
    "https://as-cdn29.top/",
    "https://as-cdn30.top/",
    "https://animesalt.cx/",
    "https://abyssplayer.com/",
    "https://playhydrax.com/",
    targetOrigin ? targetOrigin + "/" : null,
    "",                                // last resort: no referer
  ].filter((v, i, a) => v !== null && v !== undefined && a.indexOf(v) === i);

  // --- base headers: NO Origin by default (browsers omit it on media loads) ---
  const baseHeaders = {
    "User-Agent": UPSTREAM_UA,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "cross-site",
  };

  const clientRange = request.headers.get("Range");

  let upstreamRes = null;
  let usedReferer = "";
  let lastStatus = 0;

  for (const cand of candidates) {
    const h = { ...baseHeaders };
    if (cand) {
      h.Referer = cand;
      // Origin only for origin-level referers (pathname === "/")
      const isOriginLevel = (() => { try { return new URL(cand).pathname === "/"; } catch { return false; } })();
      if (isOriginLevel) { try { h.Origin = new URL(cand).origin; } catch {} }
    }
    if (clientRange) h.Range = clientRange;

    try {
      const r = await fetch(targetUrl, { method: request.method, headers: h, redirect: "follow" });
      lastStatus = r.status;
      if (r.status >= 200 && r.status < 300) { upstreamRes = r; usedReferer = cand; break; }
      try { if (r.body) await r.body.cancel(); } catch {}
    } catch {}
  }

  if (!upstreamRes) {
    return new Response(`Upstream error: ${lastStatus || "unreachable"}`, {
      status: 502,
      headers: { "Content-Type": "text/plain;charset=UTF-8", ...CORS_HEADERS },
    });
  }

  const upstreamCt = upstreamRes.headers.get("Content-Type") || "";
  const kind = detectKind(targetUrl, upstreamCt);

  // --- reject HTML challenge/block pages instead of streaming them as media ---
  if (kind !== "manifest" && kind !== "vtt" && /text\/html/i.test(upstreamCt)) {
    try { if (upstreamRes.body) await upstreamRes.body.cancel(); } catch {}
    return new Response("Upstream returned HTML (challenge/block page)", {
      status: 502,
      headers: { "Content-Type": "text/plain;charset=UTF-8", ...CORS_HEADERS },
    });
  }

  // --- force=text/vtt: binary placeholder → valid empty VTT ---
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

  // --- HLS manifest: rewrite + return ---
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

  // --- binary / MP4 / segment / image / VTT: stream with Range passthrough ---
  const outHeaders = new Headers({ ...CORS_HEADERS });
  const ct = upstreamRes.headers.get("Content-Type");
  if (ct) outHeaders.set("Content-Type", ct);
  const cl = upstreamRes.headers.get("Content-Length");
  if (cl) outHeaders.set("Content-Length", cl);
  const cr = upstreamRes.headers.get("Content-Range");
  if (cr) outHeaders.set("Content-Range", cr);
  outHeaders.set("Accept-Ranges", "bytes");
  outHeaders.set("Cache-Control", `public, max-age=${kind === "manifest" ? 60 : 3600}`);

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: outHeaders,
  });
}