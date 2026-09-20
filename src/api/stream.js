// ==========================================================================
// /api/stream?ep=<slug>&server=<n>&lang=<l>&audio=<a>
// ==========================================================================

import { corsHeaders } from "../config.js";
import { jsonSuccess, jsonError } from "../util/response.js";
import { handleServers } from "./servers.js";
import { resolveAsCdn26 } from "../decryptors/as-cdn26.js";
import { resolveAbyss } from "../decryptors/abyss.js";
import { proxyMediaUrl } from "../proxy/media.js";

/**
 * /api/stream?ep=<slug>&server=<n>&lang=<l>&audio=<a>
 * Resolves server embed to direct HLS/mp4 stream.
 */
export async function handleStream(ctx, url) {
  const ep = url.searchParams.get("ep");
  const serverIdx = Number(url.searchParams.get("server") || 0);
  const lang = url.searchParams.get("lang");
  const audio = url.searchParams.get("audio");

  if (!ep) return jsonError("Missing ep", 400);

  // Fetch servers list
  const srvRes = await handleServers(ctx, url);
  const servers = (await srvRes.clone().json()).data || [];
  const server = servers[serverIdx];
  if (!server) return jsonError("Server not found", 404);

  // Determine embed URL (multi-lang or single)
  let embedUrl = server.embedUrl;
  let selectedLanguage = lang || null;
  if (server.isMultiLang && server.languages.length) {
    const pick = lang
      ? server.languages.find((l) => String(l.language).toLowerCase() === lang.toLowerCase())
      : server.languages.find((l) => /eng/i.test(l.language)) || server.languages[0];
    if (pick) {
      embedUrl = pick.link;
      selectedLanguage = pick.language;
    }
  }

  // Resolve embed to direct stream
  const resolved = /as-cdn/i.test(embedUrl)
    ? await resolveAsCdn26(embedUrl)
    : await resolveAbyss(embedUrl);

  const result = {
    host: server.serverName,
    serverIndex: serverIdx,
    selectedLanguage,
    selected_audio: audio || null,
  };

  // If iframe-only, return embed URL
  if (resolved.isIframe) {
    return jsonSuccess(
      { ...result, isIframe: true, embedUrl: resolved.embedUrl },
      { "Cache-Control": "no-store" }
    );
  }

  // Direct HLS/mp4 stream
  const hlsUrl = resolved.direct_hls;
  if (!hlsUrl) {
    return jsonSuccess(
      { ...result, isIframe: true, embedUrl: server.embedUrl, error: "No playable URL" },
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