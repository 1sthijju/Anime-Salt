// ==========================================================================
// /api/stream?ep=<slug>&server=<n>&lang=<language>&audio=<code>
//
// Pipeline:
//   1. resolve episode page (series or movie) from slug
//   2. collect embed servers from the page
//   3. pick server by ?server index, apply ?lang if multi-lang
//   4. dispatch to the correct decryptor: as-cdn / megaplay / abyss / generic
//   5. assemble a unified response — ONE proxied master m3u8 with all
//      qualities + all audio tracks baked in. Audio chip URLs carry ?audio=
//      so media.js can rewrite DEFAULT=YES on the matching rendition.
// ==========================================================================

import { jsonSuccess, jsonError } from "../util/response.js";
import { fetchUpstream } from "../util/fetcher.js";
import { UPSTREAM } from "../config.js";
import { resolveAsCdn26 } from "../decryptors/as-cdn26.js";
import { resolveMegaplay } from "../decryptors/megaplay.js";
import { resolveAbyss } from "../decryptors/abyss.js";

const PROXY_BASE = "https://anime-salt.abdullahdaniyal.workers.dev/proxy/media";

// ---- helpers -----------------------------------------------------------

function proxiedUrl(url, referer, audio) {
  const qs = new URLSearchParams();
  qs.set("url", url);
  if (referer) qs.set("referer", referer);
  if (audio) qs.set("audio", audio);
  return `${PROXY_BASE}?${qs.toString()}`;
}

function proxiedSub(url, referer) {
  const qs = new URLSearchParams();
  qs.set("url", url);
  if (referer) qs.set("referer", referer);
  qs.set("force", "text/vtt");     // always safe for subtitles
  return `${PROXY_BASE}?${qs.toString()}`;
}

function normLang(label) {
  const m = { english:"en", japanese:"ja", hindi:"hi", spanish:"es", french:"fr",
              german:"de", italian:"it", portuguese:"pt", russian:"ru", korean:"ko",
              chinese:"zh", arabic:"ar", indonesian:"id", urdu:"ur", bengali:"bn",
              tamil:"ta", telugu:"te" };
  const k = String(label || "").toLowerCase();
  return m[k] || (k.replace(/[^a-z]/g, "").slice(0, 2)) || "en";
}

// ---- episode / movie page lookup ---------------------------------------

async function pageForSlug(slug) {
  const episodePage = `${UPSTREAM}/episode/${slug}/`;
  try { return { html: await fetchUpstream(episodePage), referer: episodePage }; } catch {}
  const moviePage = `${UPSTREAM}/movies/${slug}/`;
  try { return { html: await fetchUpstream(moviePage), referer: moviePage }; } catch {}
  throw new Error(`No page found for slug "${slug}"`);
}

// Extract embed iframes / server blocks from the title page.
function extractServers(html) {
  const out = [];

  // iframes
  const ifrRe = /<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = ifrRe.exec(html))) {
    const raw = m[1].replace(/\\\//g, "/");
    const src = raw.startsWith("//") ? "https:" + raw : raw;
    out.push({ index: out.length, embedUrl: src, serverName: `Server ${out.length + 1}` });
  }

  // some sites expose embeds via data attributes on server tabs
  const dataRe = /data-(?:src|embed|url)=["']([^"']+)["']/gi;
  while ((m = dataRe.exec(html))) {
    const src = m[1].replace(/\\\//g, "/");
    if (out.some(s => s.embedUrl === src)) continue;
    out.push({ index: out.length, embedUrl: src, serverName: `Server ${out.length + 1}` });
  }

  // multi-lang servers (e.g. Server 2 with Hindi/English tabs)
  const langBlockRe = /<div[^>]+class=["'][^"']*(?:server|lang|dub)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  while ((m = langBlockRe.exec(html))) {
    const block = m[1];
    const langRe = /data-lang=["']([^"']+)["'][^>]*data-(?:src|embed)=["']([^"']+)["']/gi;
    const langs = [];
    let lm;
    while ((lm = langRe.exec(block))) {
      langs.push({ language: lm[1], link: lm[2].replace(/\\\//g, "/") });
    }
    if (langs.length > 1) {
      out.push({
        index: out.length,
        embedUrl: langs[0].link,
        serverName: `Server ${out.length + 1}`,
        isMultiLang: true,
        languages: langs,
      });
    }
  }

  return out;
}

// ---- decryptor dispatch ------------------------------------------------

async function resolveEmbed(embedUrl) {
  if (!embedUrl) return { isIframe: true };
  if (/as-cdn/i.test(embedUrl))   return resolveAsCdn26(embedUrl);
  if (/megaplay/i.test(embedUrl)) return resolveMegaplay(embedUrl);
  if (/abyssplayer|abyss\.to|playhydrax/i.test(embedUrl)) return resolveAbyss(embedUrl);

  // generic: try to extract m3u8 directly, else iframe fallback
  try {
    const res = await fetch(embedUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      redirect: "follow",
    });
    const html = await res.text();
    const m3u8M = html.match(/(https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*)/i);
    if (m3u8M) return { direct_hls: m3u8M[1], isIframe: false, qualities: [], subtitles: [], audio_languages: [] };
  } catch {}
  return { embedUrl, isIframe: true };
}

// ---- handler -----------------------------------------------------------

export async function handleStream(url, ctx, req) {
  const ep     = url.searchParams.get("ep");
  const server = Number(url.searchParams.get("server") ?? "0");
  const lang   = url.searchParams.get("lang") || null;
  const audio  = url.searchParams.get("audio") || null;

  if (!ep) return jsonError("Missing ?ep=", 400);

  try {
    // 1) page + servers
    const { html, referer } = await pageForSlug(ep);
    const servers = extractServers(html);
    if (!servers.length) return jsonError("No servers found on page", 404);

    const srv = servers.find(s => s.index === server) || servers[0];

    // 2) pick the right embed (apply multi-lang)
    let embedUrl = srv.embedUrl;
    let selectedLanguage = null;
    if (srv.isMultiLang && lang) {
      const pick = (srv.languages || []).find(l =>
        (l.language || "").toLowerCase() === lang.toLowerCase());
      if (pick) { embedUrl = pick.link; selectedLanguage = pick.language; }
    }

    // 3) decrypt
    let resolved;
    try { resolved = await resolveEmbed(embedUrl); }
    catch (e) { resolved = { embedUrl, isIframe: true, debug: e.message }; }

    if (resolved.isIframe) {
      return jsonSuccess({
        host: srv.serverName,
        serverIndex: srv.index,
        selectedLanguage,
        isIframe: true,
        embedUrl: resolved.embedUrl || embedUrl,
        debug: resolved.debug || null,
      });
    }

    // 4) build unified HLS response
    const hls       = resolved.direct_hls || (resolved.qualities?.[0]?.url) || null;
    const hlsReferer = resolved.referer || referer;

    if (!hls) {
      return jsonSuccess({
        host: srv.serverName, serverIndex: srv.index,
        selectedLanguage, isIframe: true, embedUrl,
        debug: "decryptor returned no playable URL",
      });
    }

    // master URL — every client fetches the same cached manifest
    const proxiedMaster = proxiedUrl(hls, hlsReferer, null);

    // per-audio chip URLs carry ?audio= so media.js rewrites DEFAULT=YES on the
    // matching #EXT-X-MEDIA line when hls.js loads it
    const audioLangs = (resolved.audio_languages || []).map(a => ({
      language: a.language || normLang(a.name || a.label),
      name: a.name || a.label || a.language,
      url: proxiedUrl(hls, hlsReferer, a.language),   // ← audio= baked in
      isDefault: !!a.isDefault,
      isAutoSelect: a.isAutoSelect !== false,
    }));

    const subtitles = (resolved.subtitles || []).map(s => ({
      label: s.label || s.language || "Subtitles",
      url: proxiedSub(s.url, hlsReferer),
    }));

    return jsonSuccess({
      host: srv.serverName,
      serverIndex: srv.index,
      selectedLanguage,
      selected_audio: audio || null,
      isIframe: false,
      proxied_url: proxiedMaster,
      direct_hls: hls,
      referer: hlsReferer,
      poster: resolved.poster || null,
      qualities: (resolved.qualities || []).map(q => ({
        label: q.label,
        bandwidth: q.bandwidth,
        resolution: q.resolution,
        url: q.url,
      })),
      audio_languages: audioLangs,
      subtitles,
      subtitle_languages: resolved.subtitle_languages || [],
      intro: resolved.intro || null,
      outro: resolved.outro || null,
    });
  } catch (e) {
    return jsonError(e.message, 500, e.stack);
  }
}