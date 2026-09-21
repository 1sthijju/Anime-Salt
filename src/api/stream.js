// ==========================================================================
// /api/stream?ep=<slug>&server=<n>&lang=<language>&audio=<code>
//
// Pipeline:
//   1. Server list via existing handleServers() (single source of truth)
//   2. Pick embed URL (apply ?lang for multi-lang servers)
//   3. short.icu → player.abyssplayer.com domain rewrite, then follow
//      redirects, then dispatch to decryptor: as-cdn26 / megaplay /
//      abyss(hydrax) / generic m3u8 / iframe fallback
//   4. Assemble unified response: ONE proxied master m3u8 (all qualities +
//      all audio renditions). Audio chip URLs carry ?audio=<code> so
//      proxy/media.js flips DEFAULT=YES on the matching rendition.
// ==========================================================================

import { jsonSuccess, jsonError } from "../util/response.js";
import { handleServers } from "./servers.js";
import { resolveAsCdn26 } from "../decryptors/as-cdn26.js";
import { resolveMegaplay } from "../decryptors/megaplay.js";
import { resolveAbyss } from "../decryptors/abyss.js";
import { proxyMediaUrl } from "../proxy/media.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Domain rewrites — short.icu links are actually abyssplayer embeds.
// Rewrite BEFORE any fetch so the Worker never has to follow the shortener.
// ---------------------------------------------------------------------------
const DOMAIN_REWRITES = [
  [/^https?:\/\/short\.icu\//i, "https://player.abyssplayer.com/"],
  [/^https?:\/\/(?:www\.)?abyss\.to\//i, "https://player.abyssplayer.com/"],
  [/^https?:\/\/(?:www\.)?playhydrax\.com\//i, "https://player.abyssplayer.com/"],
];
function applyRewrites(url) {
  if (!url) return url;
  for (const [re, replacement] of DOMAIN_REWRITES) {
    if (re.test(url)) return url.replace(re, replacement);
  }
  return url;
}

// ---------------------------------------------------------------------------
// Follow any remaining redirects + dispatch to the right decryptor.
// ---------------------------------------------------------------------------
async function followAndResolve(embedUrl) {
  const rewritten = applyRewrites(embedUrl);
  if (!rewritten) return { embedUrl, isIframe: true };

  // After rewrite, try the URL directly with each decryptor
  if (/as-cdn/i.test(rewritten)) return resolveAsCdn26(rewritten);
  if (/megaplay/i.test(rewritten)) return resolveMegaplay(rewritten);
  if (/abyssplayer|abyss\.to|playhydrax/i.test(rewritten)) return resolveAbyss(rewritten);

  // Still unknown — follow redirects, then dispatch again
  let finalUrl = rewritten;
  try {
    const res = await fetch(rewritten, {
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    });
    finalUrl = applyRewrites(res.url || rewritten);
  } catch {}

  if (/as-cdn/i.test(finalUrl)) return resolveAsCdn26(finalUrl);
  if (/megaplay/i.test(finalUrl)) return resolveMegaplay(finalUrl);
  if (/abyssplayer|abyss\.to|playhydrax/i.test(finalUrl)) return resolveAbyss(finalUrl);

  // Final fallback: look for iframe or plain m3u8 on the landing page
  try {
    const res = await fetch(finalUrl, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    const html = await res.text();

    const iframeM = html.match(/<iframe[^>]*src=["']([^"']+)["']/i);
    if (iframeM) {
      const inner = applyRewrites(iframeM[1].replace(/\\\//g, "/").replace(/^\/\//, "https://"));
      if (/as-cdn/i.test(inner))              return resolveAsCdn26(inner);
      if (/megaplay/i.test(inner))            return resolveMegaplay(inner);
      if (/abyssplayer|abyss\.to|playhydrax/i.test(inner)) return resolveAbyss(inner);
      const innerResolved = await resolveAbyss(inner);
      if (innerResolved && innerResolved.direct_hls) return innerResolved;
    }

    const m3u8M = html.match(/(https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*)/i);
    if (m3u8M) {
      return {
        direct_hls: m3u8M[1],
        qualities: [], subtitles: [], audio_languages: [], subtitle_languages: [],
        isIframe: false,
      };
    }
  } catch {}

  return { embedUrl: rewritten, isIframe: true, debug: `no extractor matched ${finalUrl}` };
}

// ---------------------------------------------------------------------------
// top-level dispatcher
// ---------------------------------------------------------------------------
async function resolveEmbed(embedUrl) {
  if (!embedUrl) return { isIframe: true };
  const rewritten = applyRewrites(embedUrl);
  if (/as-cdn/i.test(rewritten))              return resolveAsCdn26(rewritten);
  if (/megaplay/i.test(rewritten))            return resolveMegaplay(rewritten);
  if (/abyssplayer|abyss\.to|playhydrax/i.test(rewritten)) return resolveAbyss(rewritten);
  if (/short\.icu|multi-lang-plyr/i.test(rewritten)) return followAndResolve(rewritten);
  return followAndResolve(embedUrl);
}

// ---------------------------------------------------------------------------
// main handler — signature matches index.js: handleStream(ctx, url)
// ---------------------------------------------------------------------------
export async function handleStream(ctx, url) {
  const ep        = url.searchParams.get("ep");
  const serverIdx = Number(url.searchParams.get("server") || 0);
  const lang      = url.searchParams.get("lang") || null;
  const audio     = url.searchParams.get("audio") || null;

  if (!ep) return jsonError("Missing ep", 400);

  // 1) server list (reuses /api/servers logic + cache)
  let servers = [];
  try {
    const srvRes = await handleServers(ctx, url);
    const parsed = await srvRes.clone().json();
    servers = Array.isArray(parsed) ? parsed : (parsed && parsed.data) || [];
  } catch {}
  if (!servers.length) return jsonError("No servers available", 500);

  const server = servers[serverIdx];
  if (!server) return jsonError(`Server ${serverIdx} not found (have ${servers.length})`, 404);

  // 2) pick embed URL (multi-lang aware) + apply domain rewrites
  let embedUrl = applyRewrites(server.embedUrl);
  let selectedLanguage = lang;
  if (server.isMultiLang && Array.isArray(server.languages) && server.languages.length) {
    const pick = lang
      ? server.languages.find((l) => String(l.language).toLowerCase() === String(lang).toLowerCase())
      : server.languages[0];
    if (pick && pick.link) {
      embedUrl = applyRewrites(pick.link);
      selectedLanguage = pick.language;
    }
  }
  if (!embedUrl) {
    return jsonSuccess(
      { host: server.serverName, serverIndex: serverIdx, error: "No embed URL" },
      { "Cache-Control": "no-store" }
    );
  }

  // 3) decrypt
  let resolved;
  try {
    resolved = await resolveEmbed(embedUrl);
  } catch (e) {
    resolved = { isIframe: true, embedUrl, debug: e.message };
  }
  if (!resolved) resolved = { isIframe: true, embedUrl };

  const base = {
    host: server.serverName,
    serverIndex: serverIdx,
    selectedLanguage,
    selected_audio: audio,
  };

  if (resolved.isIframe || !resolved.direct_hls) {
    return jsonSuccess(
      {
        ...base,
        isIframe: true,
        embedUrl: resolved.embedUrl || embedUrl,
        debug: resolved.debug || null,
      },
      { "Cache-Control": "no-store" }
    );
  }

  // 4) unified HLS response
  const hls        = resolved.direct_hls;
  const hlsReferer = resolved.referer || new URL(hls).origin + "/";

  const audioLangs = (resolved.audio_languages || []).map((a) => ({
    language: a.language || "und",
    name: a.name || a.label || a.language || "Audio",
    url: proxyMediaUrl(url.origin, hls, { referer: hlsReferer, audio: a.language }),
    isDefault: !!a.isDefault,
    isAutoSelect: a.isAutoSelect !== false,
  }));

  const subtitles = (resolved.subtitles || []).map((s) => ({
    label: s.label || s.language || "Subtitles",
    url: proxyMediaUrl(url.origin, s.url, {
      referer: s.referer || hlsReferer,
      force: "text/vtt",
    }),
  }));

  return jsonSuccess(
    {
      ...base,
      isIframe: false,
      proxied_url: proxyMediaUrl(url.origin, hls, { referer: hlsReferer }),
      direct_hls: hls,
      referer: hlsReferer,
      poster: resolved.poster || null,
      qualities: (resolved.qualities || []).map((q) => ({
        label: q.label,
        bandwidth: q.bandwidth,
        resolution: q.resolution,
        url: q.url,
        audioGroup: q.audioGroup || null,
      })),
      audio_languages: audioLangs,
      subtitles,
      subtitle_languages: resolved.subtitle_languages || [],
      intro: resolved.intro || null,
      outro: resolved.outro || null,
    },
    { "Cache-Control": "no-store" }
  );
}