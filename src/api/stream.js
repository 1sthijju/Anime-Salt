// ==========================================================================
// /api/stream?ep=<slug>&server=<n>&lang=<l>&audio=<a>
// ==========================================================================

import { jsonSuccess, jsonError } from "../util/response.js";
import { handleServers } from "./servers.js";
import { resolveAsCdn26 } from "../decryptors/as-cdn26.js";
import { resolveAbyss } from "../decryptors/abyss.js";
import { proxyMediaUrl } from "../proxy/media.js";

export async function handleStream(ctx, url) {
  const ep = url.searchParams.get("ep");
  const serverIdx = Number(url.searchParams.get("server") || 0);
  const lang = url.searchParams.get("lang");
  const audio = url.searchParams.get("audio");

  if (!ep) return jsonError("Missing ep", 400);

  // Fetch servers — cached() returns a Response whose body is the raw array JSON
  const srvRes = await handleServers(ctx, url);
  let servers;
  try {
    const parsed = await srvRes.clone().json();
    // cached() may wrap in {success,data} OR return raw array
    servers = Array.isArray(parsed) ? parsed : (parsed && parsed.data) || [];
  } catch {
    servers = [];
  }

  if (!servers.length) return jsonError("No servers available", 500);
  const server = servers[serverIdx];
  if (!server) return jsonError(`Server ${serverIdx} not found (have ${servers.length})`, 404);

  // Pick embed URL — multi-lang with language, or default embed
  let embedUrl = server.embedUrl;
  let selectedLanguage = lang || null;

  if (server.isMultiLang && server.languages && server.languages.length) {
    const pick = lang
      ? server.languages.find(
          (l) => String(l.language).toLowerCase() === lang.toLowerCase()
        )
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

  // Resolve embed to direct stream
  let resolved;
  try {
    if (/as-cdn26|as-cdn/i.test(embedUrl)) {
      resolved = await resolveAsCdn26(embedUrl);
    } else if (/short\.icu|multi-lang-plyr/i.test(embedUrl)) {
      // Multi-lang shortener links → follow redirect to find real embed
      resolved = await followShortener(embedUrl);
    } else {
      resolved = await resolveAbyss(embedUrl);
    }
  } catch (e) {
    return jsonSuccess(
      {
        host: server.serverName,
        serverIndex: serverIdx,
        isIframe: true,
        embedUrl,
        error: `Resolve failed: ${e.message}`,
      },
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
    return jsonSuccess(
      { ...result, isIframe: true, embedUrl: resolved.embedUrl },
      { "Cache-Control": "no-store" }
    );
  }

  const hlsUrl = resolved.direct_hls;
  if (!hlsUrl) {
    return jsonSuccess(
      { ...result, isIframe: true, embedUrl, error: "No playable URL" },
      { "Cache-Control": "no-store" }
    );
  }

  const referer = resolved.referer || new URL(hlsUrl).origin + "/";
  result.proxied_url = proxyMediaUrl(url.origin, hlsUrl, { referer, audio });
  result.direct_hls = hlsUrl;
  result.referer = referer;
  result.qualities = resolved.qualities || [];
  result.poster = resolved.poster || null;
  result.isIframe = false;
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

/**
 * Follow a shortener URL (short.icu etc.) to find the real embed.
 * Shorteners often redirect to an iframe host that then loads an as-cdn video.
 */
async function followShortener(shortUrl) {
  const res = await fetch(shortUrl, {
    redirect: "manual",
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const location = res.headers.get("location");
  if (location) {
    if (/as-cdn/i.test(location)) return resolveAsCdn26(location);
    return resolveAbyss(location);
  }
  // Follow redirect chain manually
  const finalRes = await fetch(shortUrl, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const html = await finalRes.text();
  // Look for embedded iframe
  const iframeM = html.match(/<iframe[^>]*src="([^"]+)"[^>]*>/i);
  if (iframeM) {
    const innerUrl = iframeM[1].replace(/\\\//g, "/");
    if (/as-cdn/i.test(innerUrl)) return resolveAsCdn26(innerUrl);
    return resolveAbyss(innerUrl);
  }
  return { embedUrl: shortUrl, isIframe: true };
}