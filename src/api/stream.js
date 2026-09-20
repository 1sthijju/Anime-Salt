// src/api/stream.js
import { fetchUpstream } from "../util/fetcher.js";
import { resolveAsCdn26 } from "../decryptors/as-cdn26.js";
import { resolveAbyss } from "../decryptors/abyss.js";
import { jsonSuccess, jsonError } from "../util/response.js";
import { handleServers } from "./servers.js";

/**
 * Extract subtitles from episode page JavaScript
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

    // Pattern 3: Raw .vtt / .srt URLs
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
 * Follow short.icu redirects to find actual video URL
 */
async function followShortener(shortUrl) {
  try {
    const response = await fetch(shortUrl, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        // Follow the redirect
        if (location.includes('as-cdn26.top')) {
          return await resolveAsCdn26(location);
        } else {
          return await resolveAbyss(location);
        }
      }
    }
    
    // If no redirect, try to extract iframe from the page
    const html = await response.text();
    const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframeMatch) {
      const iframeUrl = iframeMatch[1];
      if (iframeUrl.includes('as-cdn26.top')) {
        return await resolveAsCdn26(iframeUrl);
      } else {
        return await resolveAbyss(iframeUrl);
      }
    }
    
    return { isIframe: true, embedUrl: shortUrl };
  } catch (error) {
    console.error('Failed to follow shortener:', error.message);
    return { isIframe: true, embedUrl: shortUrl };
  }
}

/**
 * Handle /api/stream requests
 */
export async function handleStream(ctx, url) {
  try {
    const ep = url.searchParams.get('ep');
    const serverIdx = parseInt(url.searchParams.get('server') || '0', 10);
    const lang = url.searchParams.get('lang');
    const audio = url.searchParams.get('audio');

    if (!ep) {
      return jsonError('Missing ep parameter', 400);
    }

    // Get servers for this episode
    const serversResponse = await handleServers(ctx, url);
    const serversData = await serversResponse.json();
    
    if (!serversData.success) {
      return serversResponse;
    }

    const servers = serversData.data || [];
    if (!servers[serverIdx]) {
      return jsonError(`Server ${serverIdx} not found`, 404);
    }

    const server = servers[serverIdx];
    let embedUrl = server.embedUrl;

    // Handle multi-lang servers
    if (server.isMultiLang && server.languages && server.languages.length > 0) {
      const langObj = lang 
        ? server.languages.find(l => l.language.toLowerCase() === lang.toLowerCase())
        : server.languages[0];
      
      if (langObj && langObj.link) {
        embedUrl = langObj.link;
      }
    }

    // Resolve the embed URL
    let resolved;
    if (embedUrl.includes('short.icu')) {
      resolved = await followShortener(embedUrl);
    } else if (embedUrl.includes('as-cdn26.top')) {
      resolved = await resolveAsCdn26(embedUrl);
    } else {
      resolved = await resolveAbyss(embedUrl);
    }

    // Extract subtitles from episode page
    const pageSubtitles = await extractSubtitlesFromPage(ep);

    // Merge subtitles from decryptor and page
    const allSubtitles = [
      ...(resolved.subtitles || []),
      ...pageSubtitles
    ];

    // Deduplicate by URL
    const uniqueSubtitles = allSubtitles.reduce((acc, sub) => {
      if (!acc.find(s => s.url === sub.url)) {
        acc.push(sub);
      }
      return acc;
    }, []);

    // Build response
    const result = {
      success: true,
      data: {
        host: server.serverName,
        serverIndex: serverIdx,
        selectedLanguage: lang,
        selected_audio: audio,
        direct_hls: resolved.direct_hls,
        referer: resolved.referer,
        qualities: resolved.qualities || [],
        poster: resolved.poster,
        isIframe: resolved.isIframe || false,
        subtitles: uniqueSubtitles,
        audio_languages: resolved.audio_languages || [],
        subtitle_languages: resolved.subtitle_languages || [],
      }
    };

    // Add proxied URL if we have a direct HLS stream
    if (resolved.direct_hls) {
      result.data.proxied_url = `/proxy/media?url=${encodeURIComponent(resolved.direct_hls)}&referer=${encodeURIComponent(resolved.referer || '')}`;
    }

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (error) {
    console.error('[STREAM] Error:', error);
    return jsonError(error.message, 500);
  }
}