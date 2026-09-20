// ==========================================================================
// /api/stream?ep=<slug>&server=<n>&lang=<l>&audio=<a>
// Decodes embed URLs to direct HLS streams via decryptors
// ==========================================================================

import { jsonSuccess, jsonError } from "../util/response.js";
import { handleServers } from "./servers.js";
import { resolveAsCdn26 } from "../decryptors/as-cdn26.js";
import { resolveAbyss } from "../decryptors/abyss.js";
import { resolveMegaplay } from "../decryptors/megaplay.js";
import { proxyMediaUrl } from "../proxy/media.js";
import { fetchUpstream } from "../util/fetcher.js";

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
  if (/megaplay/i.test(finalUrl)) return resolveMegaplay(finalUrl);

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
      if (/megaplay/i.test(innerUrl)) return resolveMegaplay(innerUrl);
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
 * Extract subtitles from episode page (working version from earlier)
 */
async function extractSubtitlesFromPage(epSlug) {
  try {
    const html = await fetchUpstream(`/episode/${epSlug}/`);
    const subtitles = [];

    // Pattern 1: playerjsSubtitle variable
    const pjsMatch = html.match(/var\s+playerjsSubtitle\s*=\s*["']([^"']*)["']/i);
    if (pjsMatch && pjsMatch[1].trim() !== "") {
      const re = /\[([^\]]+)\]\s*(https?:\/\/[^"'\s,;]+)/g;
      let pm;
      while ((pm = re.exec(pjsMatch[1])) !== null) {
        const label = pm[1].trim();
        const url = pm[2].trim();
        if (url) {
          subtitles.push({
            label: label || "Sub",
            url: url,
            referer: new URL(url).origin + "/",
          });
        }
      }
    }

    return subtitles;
  } catch (e) {
    console.error("Failed to extract subtitles from page:", e.message);
    return [];
  }
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

  // 1. Fetch servers list
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
    } else if (/megaplay\.buzz/i.test(embedUrl)) {
      resolved = await resolveMegaplay(embedUrl);
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
  result.intro = resolved.intro || null;
  result.outro = resolved.outro || null;
  
  // Map subtitles from decryptor
  result.subtitles = (resolved.subtitles || []).map((s) => ({
    label: s.label || "Sub",
    url: proxyMediaUrl(url.origin, s.url, {
      referer: s.referer || referer,
      force: "text/vtt",
    }),
  }));
  
  result.audio_languages = resolved.audio_languages || [];
  result.subtitle_languages = resolved.subtitle_languages || [];

  return jsonSuccess(result, { "Cache-Control": "no-store" });
}