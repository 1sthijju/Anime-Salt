import { CHROME_HEADERS, corsHeaders } from "./config.js";

export function proxyMediaUrl(workerOrigin, url, params = {}) {
  const u = new URL("/proxy/media", workerOrigin);
  u.searchParams.set("url", url);
  for (const [k, v] of Object.entries(params)) {
    if (v) u.searchParams.set(k, v);
  }
  return u.toString();
}

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

function langMatches(trackValue, wanted) {
  const a = (trackValue || "").toLowerCase();
  const b = (wanted || "").toLowerCase();
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

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

function isBinaryImage(text) {
  const signatures = ["\u00FF\u00D8\u00FF", "\u0089PNG", "GIF87a", "GIF89a", "RIFF"];
  return signatures.some(sig => text.startsWith(sig));
}

async function fetchUpstream(targetUrl, referer, rangeHeader) {
  const candidates = [];
  const add = (r) => { if (typeof r === "string" && !candidates.includes(r)) candidates.push(r); };

  add(referer || "");
  try { if (referer) add(new URL(referer).origin + "/"); } catch {}
  try { add(new URL(targetUrl).origin + "/"); } catch {}
  add("https://as-cdn26.top/");
  add("https://animesalt.cx/");
  add("");

  let lastStatus = 0;
  for (const r of candidates) {
    const headers = new Headers();
    headers.set("User-Agent", CHROME_HEADERS["User-Agent"]);
    headers.set("Accept", "*/*");
    if (r) {
      headers.set("Referer", r);
      try { headers.set("Origin", new URL(r).origin); } catch {}
    }
    if (rangeHeader) headers.set("Range", rangeHeader);

    let res;
    try {
      res = await fetch(targetUrl, { headers, redirect: "follow", cf: { cacheTtl: 0 } });
    } catch (e) { 
      lastStatus = 0; 
      continue; 
    }

    if (res.ok) return { ok: true, response: res };

    lastStatus = res.status;
    try { if (res.body) await res.body.cancel(); } catch {}
    if (lastStatus !== 403 && lastStatus !== 404) break;
  }
  return { ok: false, status: lastStatus };
}

export async function handleMediaProxy(request) {
  try {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");
    let referer = url.searchParams.get("referer");
    const forceType = url.searchParams.get("force");
    const audioLang = url.searchParams.get("audio");

    if (!targetUrl) {
      return new Response("Missing url parameter", { status: 400, headers: corsHeaders });
    }
    if (!referer) {
      try { referer = new URL(targetUrl).origin + "/"; } catch { referer = ""; }
    }
    const workerOrigin = url.origin;

    const result = await fetchUpstream(targetUrl, referer, request.headers.get("Range"));
    
    if (!result.ok) {
      // Return empty VTT for subtitles when upstream fails
      if (forceType === "text/vtt") {
        return new Response("WEBVTT\n\n", {
          headers: {
            "Content-Type": "text/vtt",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=60",
          },
        });
      }
      return new Response(`Upstream error: ${result.status || 'unknown'}`, {
        status: 502,
        headers: corsHeaders,
      });
    }

    const res = result.response;
    const ct = ((res.headers && res.headers.get("Content-Type")) || "").toLowerCase();

    // ---- forced subtitle conversion ----
    if (forceType === "text/vtt") {
      try {
        const text = await res.text();
        
        // Reject binary image data
        if (isBinaryImage(text)) {
          return new Response("WEBVTT\n\n", {
            headers: {
              "Content-Type": "text/vtt",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "public, max-age=60",
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
      } catch (e) {
        return new Response("WEBVTT\n\n", {
          headers: {
            "Content-Type": "text/vtt",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=60",
          },
        });
      }
    }

    // ---- HLS manifest rewriting ----
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

    // ---- binary passthrough ----
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
    if (res.headers && res.headers.has("Content-Range")) rh.set("Content-Range", res.headers.get("Content-Range"));
    if (res.headers && res.headers.has("Content-Length")) rh.set("Content-Length", res.headers.get("Content-Length"));
    return new Response(stream, { status: res.status, headers: rh });
  } catch (error) {
    console.error("Media proxy error:", error.message, error.stack);
    return new Response(`Proxy error: ${error.message}`, {
      status: 500,
      headers: corsHeaders,
    });
  }
}