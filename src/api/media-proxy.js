import { corsHeaders } from './config.js';

export async function handleMediaProxy(request) {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");
  const referer = url.searchParams.get("referer");
  const forceType = url.searchParams.get("force");
  const audioLang = url.searchParams.get("audio");
  
  if (!targetUrl) return new Response("Missing url", { status: 400 });
  
  const headers = new Headers();
  if (referer) { headers.set("Referer", referer); headers.set("Origin", new URL(referer).origin); }
  headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
  if (request.headers.has("Range")) headers.set("Range", request.headers.get("Range"));
  
  const res = await fetch(targetUrl, { headers });
  const contentType = forceType || res.headers.get("Content-Type") || "application/octet-stream";
  
  if (contentType.includes("mpegurl") || targetUrl.includes(".m3u8")) {
    let manifest = await res.text();
    manifest = rewriteHlsManifest(manifest, targetUrl, referer, audioLang);
    return new Response(manifest, { status: res.status, headers: { "Content-Type": "application/vnd.apple.mpegurl", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } });
  }
  
  if (contentType.includes("subrip") || targetUrl.includes(".srt") || forceType === "text/vtt") {
    let srt = await res.text();
    let vtt = "WEBVTT\n\n" + srt.replace(/\r\n/g, "\n"); 
    return new Response(vtt, { headers: { "Content-Type": "text/vtt", "Access-Control-Allow-Origin": "*" } });
  }
  
  const responseHeaders = new Headers(res.headers);
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Content-Type", contentType);
  return new Response(res.body, { status: res.status, headers: responseHeaders });
}

function rewriteHlsManifest(manifest, baseUrl, referer, audioLang) {
  const lines = manifest.split("\n");
  const out = [];
  
  for (let line of lines) {
    if (line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO")) {
      if (audioLang) {
        const langMatch = line.match(/LANGUAGE="([^"]+)"/);
        if (langMatch && langMatch[1].toLowerCase().includes(audioLang.toLowerCase())) {
          line = line.replace(/DEFAULT=NO/, "DEFAULT=YES").replace(/AUTOSELECT=NO/, "AUTOSELECT=YES");
        } else {
          line = line.replace(/DEFAULT=YES/, "DEFAULT=NO").replace(/AUTOSELECT=YES/, "AUTOSELECT=NO");
        }
      }
    }
    
    if (line.startsWith("#")) {
      line = line.replace(/URI="([^"]+)"/g, (match, uri) => {
        const absolute = new URL(uri, baseUrl).toString();
        const proxyUrl = `/proxy/media?url=${encodeURIComponent(absolute)}${referer ? `&referer=${encodeURIComponent(referer)}` : ''}`;
        return `URI="${proxyUrl}"`;
      });
      out.push(line);
    } else if (line.trim()) {
      const absolute = new URL(line.trim(), baseUrl).toString();
      const proxyUrl = `/proxy/media?url=${encodeURIComponent(absolute)}${referer ? `&referer=${encodeURIComponent(referer)}` : ''}`;
      out.push(proxyUrl);
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}