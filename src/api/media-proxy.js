import { CHROME_HEADERS, corsHeaders } from "./config.js";

// ---------------------------------------------------------------------------
// Build a /proxy/media link
// ---------------------------------------------------------------------------
export function proxyMediaUrl(workerOrigin, url, params = {}) {
  const u = new URL("/proxy/media", workerOrigin);
  u.searchParams.set("url", url);
  for (const [k, v] of Object.entries(params)) {
    if (v) u.searchParams.set(k, v);
  }
  return u.toString();
}

// ---------------------------------------------------------------------------
// Parse #EXT-X-MEDIA audio/subtitle groups from a master playlist
// ---------------------------------------------------------------------------
export function parseHlsMediaGroups(manifest) {
  const audio = [];
  const subtitles = [];
  for (const line of manifest.split(/\r?\n/)) {
    if (!line.startsWith("#EXT-X-MEDIA:")) continue;
    const lang = (line.match(/LANGUAGE="([^"]+)"/) || [])[1];
    const name = (line.match(/NAME="([^"]+)"/) || [])[1];
    const isDefault = line.includes("DEFAULT=YES");
    if (line.includes("TYPE=AUDIO") && lang) {
      audio.push({ language: lang, name: name || lang, default: isDefault });
    } else if (line.includes("TYPE=SUBTITLES") && lang) {
      subtitles.push({ language: lang, name: name || lang, default: isDefault });
    }
  }
  return { audio, subtitles };
}

// ---------------------------------------------------------------------------
// Bidirectional language match (hin↔hindi, jpn↔japanese…)
// ---------------------------------------------------------------------------
function langMatches(trackValue, wanted) {
  const a = (trackValue || "").toLowerCase();
  const b = (wanted || "").toLowerCase();
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

// ---------------------------------------------------------------------------
// Rewrite EVERY url inside a manifest: URI="…" attrs + bare segment lines
// ---------------------------------------------------------------------------
function rewriteHlsManifest(manifest, baseUrl, referer, audioLang, workerOrigin) {
  const link = (abs) => proxyMediaUrl(workerOrigin, abs, { referer });
  const lines = manifest.split(/\r?\n/);
  const out = [];

  for (const raw of lines) {
    const line = raw;
    if (!line.trim()) { out.push(line); continue; }

    if (line.startsWith("#")) {
      let l = line.replace(/URI="([^"]+)"/g, (_m, uri) => {
        try { return `URI="${link(new URL(uri, baseUrl).toString())}"`; } catch { return _m; }
      });
      // audio-track switching
      if (audioLang && l.startsWith("#EXT-X-MEDIA:TYPE=AUDIO")) {
        const lang = (l.match(/LANGUAGE="([^"]+)"/) || [])[1];
        const name = (l.match(/NAME="([^"]+)"/) || [])[1];
        const hit = langMatches(lang, audioLang) || langMatches(name, audioLang);
        l = hit
          ? l.replace(/DEFAULT=NO/, "DEFAULT=YES").replace(/AUTOSELECT=NO/, "AUTOSELECT=YES")
          : l.replace(/DEFAULT=YES/, "DEFAULT=NO").replace(/AUTOSELECT=YES/, "AUTOSELECT=NO");
      }
      out.push(l);
      continue;
    }

    // bare URI line (variant playlist or segment)
    try { out.push(link(new URL(line.trim(), baseUrl).toString())); }
    catch { out.push(line); }
  }
  return out.join("\n");
}

const M3U8_HEADERS = {
  "Content-Type": "application/vnd.apple.mpegurl",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=60",
};

// ---------------------------------------------------------------------------
// Handler — sniffs the BODY, never trusts Content-Type / URL extension
// ---------------------------------------------------------------------------
export async function handleMediaProxy(request) {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");
  let referer = url.searchParams.get("referer");
  const forceType = url.searchParams.get("force");
  const audioLang = url.searchParams.get("audio");

  if (!targetUrl) return new Response("Missing url", { status: 400, headers: corsHeaders });
  if (!referer) { try { referer = new URL(targetUrl).origin + "/"; } catch { referer = ""; } }
  const workerOrigin = url.origin;

  const headers = new Headers();
  headers.set("User-Agent", CHROME_HEADERS["User-Agent"]);
  headers.set("Accept", "*/*");
  if (referer) {
    headers.set("Referer", referer);
    try { headers.set("Origin", new URL(referer).origin); } catch {}
  }
  if (request.headers.has("Range")) headers.set("Range", request.headers.get("Range"));

  let res;
  try {
    res = await fetch(targetUrl, { headers, redirect: "follow", cf: { cacheTtl: 0 } });
  } catch (e) {
    return new Response("Upstream fetch failed: " + e.message, { status: 502, headers: corsHeaders });
  }
  if (!res.ok) {
    return new Response("Upstream returned " + res.status, { status: 502, headers: corsHeaders });
  }

  const ct = (res.headers.get("Content-Type") || "").toLowerCase();

  // ---- forced subtitle conversion ----
  if (forceType === "text/vtt") {
    const text = await res.text();
    const vtt = text.trimStart().startsWith("WEBVTT")
      ? text
      : "WEBVTT\n\n" + text.replace(/\r\n/g, "\n");
    return new Response(vtt, { headers: { "Content-Type": "text/vtt", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } });
  }

  // ---- sniff first chunk: if body starts with #EXTM3U → rewrite it ----
  const reader = res.body.getReader();
  const first = await reader.read();
  const headText = first.value ? new TextDecoder().decode(first.value.subarray(0, 64)) : "";

  if (!first.done && headText.trimStart().startsWith("#EXTM3U")) {
    let text = new TextDecoder().decode(first.value);
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      text += new TextDecoder().decode(r.value);
    }
    const rewritten = rewriteHlsManifest(text, targetUrl, referer, audioLang, workerOrigin);
    return new Response(rewritten, { headers: M3U8_HEADERS });
  }

  // ---- binary passthrough (segments, keys, fonts, images) ----
  const stream = new ReadableStream({
    async start(c) { if (first.value) c.enqueue(first.value); },
    async pull(c) {
      const r = await reader.read();
      if (r.done) c.close(); else c.enqueue(r.value);
    },
  });
  const rh = new Headers();
  rh.set("Access-Control-Allow-Origin", "*");
  rh.set("Content-Type", ct || "application/octet-stream");
  rh.set("Cache-Control", "public, max-age=3600");
  if (res.headers.has("Content-Range")) rh.set("Content-Range", res.headers.get("Content-Range"));
  if (res.headers.has("Content-Length")) rh.set("Content-Length", res.headers.get("Content-Length"));
  return new Response(stream, { status: res.status, headers: rh });
}