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

export function setDefaultAudio(text, langCode) {
  return text.split("\n").map(line => {
    if (!line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO")) return line;
    const m = line.match(/LANGUAGE="([^"]+)"/i);
    const isMatch = m && m[1].toLowerCase() === String(langCode).toLowerCase();
    return line
      .replace(/DEFAULT=(YES|NO)/i, `DEFAULT=${isMatch ? "YES" : "NO"}`)
      .replace(/AUTOSELECT=(YES|NO)/i, `AUTOSELECT=${isMatch ? "YES" : "NO"}`);
  }).join("\n");
}

export function parseHlsMediaGroups(text) {
  const audio = [];
  const subtitles = [];
  const re = /#EXT-X-MEDIA:([^\n]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1];
    const type = (attrs.match(/TYPE=([A-Za-z-]+)/) || [])[1];
    const lang = (attrs.match(/LANGUAGE="([^"]+)"/) || [])[1];
    const name = (attrs.match(/NAME="([^"]+)"/) || [])[1];
    if (!lang) continue;
    if (type === "AUDIO") audio.push({ code: lang, name: name || lang });
    if (type === "SUBTITLES") subtitles.push({ code: lang, name: name || lang });
  }
  return { audio, subtitles };
}

// ---------------------------------------------------------------------------
// SRT -> WebVTT converter (FirePlayer serves SRT disguised as .jpg)
// ---------------------------------------------------------------------------
export function srtToVtt(srt) {
  const body = srt
    .replace(/\r+/g, "")                                   // normalize line endings
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");     // 00:00:34,910 -> 00:00:34.910
  return "WEBVTT\n\n" + body.trim() + "\n";
}

export async function handleMediaProxy(request) {
  const params = new URL(request.url).searchParams;
  const target = params.get("url");
  const audio = params.get("audio");     // e.g. "hin" — make this rendition default
  const force = params.get("force");     // e.g. "text/vtt" — subtitle mode
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

  // ------------------------------------------------------------------
  // SUBTITLE MODE: convert SRT bodies to valid WebVTT on the fly
  // ------------------------------------------------------------------
  if (force && force.includes("text/vtt")) {
    const raw = await res.text();
    const vtt = raw.trimStart().startsWith("WEBVTT") ? raw : srtToVtt(raw);
    const headers = new Headers(corsHeaders);
    headers.set("Content-Type", "text/vtt");
    headers.set("Cache-Control", "public, max-age=86400");
    headers.set("Content-Length", String(new TextEncoder().encode(vtt).length));
    headers.set("Accept-Ranges", "bytes");
    return new Response(vtt, { status: 200, headers });
  }

  const ctype = (res.headers.get("Content-Type") || "").toLowerCase();
  const isManifest = ctype.includes("mpegurl") || ctype.includes("m3u8") || u.pathname.endsWith(".m3u8");

  const headers = new Headers(corsHeaders);
  headers.set("Accept-Ranges", "bytes");
  const cr = res.headers.get("Content-Range"); if (cr) headers.set("Content-Range", cr);
  const cl = res.headers.get("Content-Length"); if (cl) headers.set("Content-Length", cl);

  if (isManifest) {
    let text = await res.text();
    text = rewriteManifest(text, target, new URL(request.url).origin);
    if (audio) text = setDefaultAudio(text, audio);
    headers.set("Content-Type", "application/vnd.apple.mpegurl");
    headers.set("Cache-Control", "public, max-age=120");
    return new Response(text, { status: res.status, headers });
  }

  // Segments disguised as .js/.css/.woff: normalize MIME for MSE friendliness
  if (/\.(js|css|woff2?)$/i.test(u.pathname)) headers.set("Content-Type", "video/mp2t");
  else headers.set("Content-Type", ctype || "application/octet-stream");

  headers.set("Cache-Control",
    (u.pathname.endsWith(".ts") || u.pathname.endsWith(".m4s") || /\.(js|css|woff2?)$/i.test(u.pathname))
      ? "public, max-age=86400"
      : "public, max-age=3600");
  return new Response(res.body, { status: res.status, headers });
}