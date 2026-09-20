// ==========================================================================
// /api/stream?ep=<slug>&server=<n>&lang=<l>&audio=<a>
// Resolves server embed to direct HLS/mp4 stream with full audio/subs
// ==========================================================================

import { jsonSuccess, jsonError } from "../util/response.js";
import { handleServers } from "./servers.js";
import { resolveAsCdn26 } from "../decryptors/as-cdn26.js";
import { resolveAbyss } from "../decryptors/abyss.js";
import { proxyMediaUrl } from "../proxy/media.js";
import { fetchUpstream } from "../util/fetcher.js";

/**
 * Extract subtitles directly from the episode page's JavaScript/HTML.
 * This catches subtitles that aren't in the HLS master manifest.
 */
async function extractSubtitlesFromPage(epSlug) {
  try {
    const html = await fetchUpstream(`/episode/${epSlug}/`);
    const subtitles = [];

    // Pattern 1: playerjsSubtitle = "[lang]url,[lang]url"
    const pjsMatch = html.match(/var\s+playerjsSubtitle\s*=\s*["']([^"']+)["']/i);
    if (pjsMatch) {
      const re = /\[([^\]]+)\]\s*(https?:\/\/[^"'\s,;]+)/g;
      let m;
      while ((m = re.exec(pjsMatch[1])) !== null) {
        const url = m[2].trim().replace(/\\\//g, "/");
        // Only add if it looks like a subtitle file
        if (/\.(vtt|srt|ass|ssa|txt)(\?|$)/i.test(url)) {
          subtitles.push({
            label: m[1].trim(),
            url,
            referer: "https://animesalt.cx/",
          });
        }
      }
    }

    // Pattern 2: var subtitles = [{file: "...", label: "..."}]
    const subVarMatch = html.match(/var\s+subtitles\s*=\s*(\[[\s\S]*?\]);/i);
    if (subVarMatch) {
      try {
        // Basic cleanup for JSON parse (single quotes to double quotes)
        const cleanJson = subVarMatch[1].replace(/'/g, '"').replace(/(\w+):/g, '"$1":');
        const subsArray = JSON.parse(cleanJson);
        subsArray.forEach((sub) => {
          if (sub.file || sub.src || sub.url) {
            const url = (sub.file || sub.src || sub.url).replace(/\\\//g, "/");
            if (/\.(vtt|srt|ass|ssa|txt)(\?|$)/i.test(url)) {
              subtitles.push({
                label: sub.label || sub.language || sub.name || "Subtitles",
                url,
                referer: "https://animesalt.cx/",
              });
            }
          }
        });
      } catch {}
    }

    // Pattern 3: Raw .vtt / .srt URLs anywhere in the HTML/JS
    const vttUrls = [...html.matchAll(/["'](https?:\/\/[^"'\s]+\.(?:vtt|srt|ass|ssa)(?:\?[^"']*)?)["']/gi)];
    vttUrls.forEach((m) => {
      const url = m[1].replace(/\\\//g, "/");
      if (!subtitles.some((s) => s.url === url)) {
        const langMatch = url.match(/\/([a-z]{2,3})\.(?:vtt|srt)/i) || url.match(/subtitles?[_-]([a-z]{2,3})/i);
        subtitles.push({
          label: langMatch ? langMatch[1].toUpperCase() : "Subtitles",
          url,
          referer: "https://animesalt.cx/",
        });
      }
    });

    return subtitles;
  } catch (e) {
    console.error("Failed to extract subtitles from page:", e.message);
    return [];
  }
}

/**
 * Follow a shortener URL (short.icu etc.) to find the real embed.
 */
async function followShortener(shortUrl) {
  let finalUrl = shortUrl;
  try {
    const res = await fetch(shortUrl, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    finalUrl = res.url;
  } catch {}

  if (/as-cdn/i.test(finalUrl)) return resolveAsCdn26(finalUrl);

  try {
    const res = await fetch(finalUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await res.text();

    const iframeM = html.match(/<iframe[^>]*src="([^"]+)"[^>]*>/i);
    if (iframeM) {
      const innerUrl = iframeM[1].replace(/\\\//g, "/").replace(/^\/\//, "https://");
      if (/as-cdn/i.test(innerUrl)) return resolveAsCdn26(innerUrl);
      const innerResolved = await resolveAbyss(innerUrl);
      if (innerResolved.direct_hls) return innerResolved;
    }

    const m3u8M = html.match(/(https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*)/i);
    if (m3u8M) {
      return { direct_hls: m3u8M[1], qualities: [], subtitles: [], isIframe: false };
    }

    const jsM = html.match(/(?:file|source|src)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i);
    if (jsM) {
      return { direct_hls: jsM[1].replace(/\\\//g, "/"), qualities: [], subtitles: [], isIframe: false };
    }
  } catch {}

  return { embedUrl: shortUrl, isIframe: true };
}

/**
 * Main stream handler
 */
export async function handleStream(ctx, url) {
  const ep = url.searchParams.get("ep");
  const serverIdx = Number(url.searchParams.get("server") || 0);
  const lang = url.searchParams.get("lang");
  const audio = url.searchParams.get("audio");

  if (!ep) return jsonError("Missing ep", 400);

  // 1. Fetch servers list (handle Response object from cached())
  const srvRes = await handleServers(ctx, url);
  let servers;
  try {
    const parsed = await srvRes.clone().json();
    servers = Array.isArray(parsed) ? parsed : (parsed && parsed.data) || [];
  } catch {
    servers = [];
  }

  if (!servers.length) return jsonError("No servers available", 500);
  const server = servers[serverIdx];
  if (!server) return jsonError(`Server ${serverIdx} not found (have ${servers.length})`, 404);

  // 2. Pick embed URL (multi-lang with language, or default embed)
  let embedUrl = server.embedUrl;
  let selectedLanguage = lang || null;

  if (server.isMultiLang && server.languages && server.languages.length) {
    const pick = lang
      ? server.languages.find((l) => String(l.language).toLowerCase() === lang.toLowerCase())
      : server.languages.find((l) => /eng/i.test(l.language)) || server.languages[0];
    if (pick) {
      embedUrl = pick.link;
      selectedLanguage = pick.language;
    }
  }

  if (!embedUrl) {
    return jsonSuccess(
      { host: server.serverName, serverIndex: serverIdx, error: "No embed URL" },
      { "Cache-Control": "no-store" }
    );
  }

  // 3. Resolve embed to direct stream
  let resolved;
  try {
    if (/as-cdn26|as-cdn/i.test(embedUrl)) {
      resolved = await resolveAsCdn26(embedUrl);
    } else if (/short\.icu|multi-lang-plyr/i.test(embedUrl)) {
      resolved = await followShortener(embedUrl);
    } else {
      resolved = await resolveAbyss(embedUrl);
    }
  } catch (e) {
    return jsonSuccess(
      { host: server.serverName, serverIndex: serverIdx, isIframe: true, embedUrl, error: `Resolve failed: ${e.message}` },
      { "Cache-Control": "no-store" }
    );
  }

  const result = {
    host: server.serverName,
    serverIndex: serverIdx,
    selectedLanguage,
    selected_audio: audio || null,
  };

  if (resolved.isIframe) {
    return jsonSuccess({ ...result, isIframe: true, embedUrl: resolved.embedUrl }, { "Cache-Control": "no-store" });
  }

  const hlsUrl = resolved.direct_hls;
  if (!hlsUrl) {
    return jsonSuccess({ ...result, isIframe: true, embedUrl, error: "No playable URL" }, { "Cache-Control": "no-store" });
  }

  const referer = resolved.referer || new URL(hlsUrl).origin + "/";
  result.proxied_url = proxyMediaUrl(url.origin, hlsUrl, { referer, audio });
  result.direct_hls = hlsUrl;
  result.referer = referer;
  result.qualities = resolved.qualities || [];
  result.poster = resolved.poster || null;
  result.isIframe = false;
  result.audio_languages = resolved.audio_languages || [];
  result.subtitle_languages = resolved.subtitle_languages || [];

  // 4. Extract subtitles from episode page JS and merge with manifest subtitles
  const pageSubtitles = await extractSubtitlesFromPage(ep);
  const allSubtitles = [...(resolved.subtitles || []), ...pageSubtitles];

  // Deduplicate by URL
  const seenUrls = new Set();
  const uniqueSubtitles = allSubtitles.filter((s) => {
    if (seenUrls.has(s.url)) return false;
    seenUrls.add(s.url);
    return true;
  });

  result.subtitles = uniqueSubtitles.map((s) => ({
    label: s.label || "Sub",
    url: proxyMediaUrl(url.origin, s.url, {
      referer: s.referer || referer,
      force: "text/vtt",
    }),
  }));

  return jsonSuccess(result, { "Cache-Control": "no-store" });
}