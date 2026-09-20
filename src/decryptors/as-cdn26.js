// ==========================================================================
// as-cdn26.top decryptor — extracts HLS from video player
// ==========================================================================

import { CHROME_HEADERS } from "../config.js";

/**
 * Resolve as-cdn26 embed URL to direct HLS stream
 * @param {string} embedUrl - https://as-cdn26.top/video/...
 * @returns {Object} { direct_hls, subtitles, poster, qualities, isIframe }
 */
export async function resolveAsCdn26(embedUrl) {
  try {
    // Extract video ID from URL
    const idMatch = embedUrl.match(/\/video\/([a-f0-9]+)/);
    if (!idMatch) return { embedUrl, isIframe: true };
    const videoId = idMatch[1];

    // Fetch player page
    const playerRes = await fetch(embedUrl, {
      headers: { ...CHROME_HEADERS, Referer: "https://as-cdn26.top/" },
    });
    const playerHtml = await playerRes.text();

    // Extract subtitles from playerjsSubtitle variable
    const subtitles = [];
    const subVar = playerHtml.match(/var\s+playerjsSubtitle\s*=\s*["']([^"']*)["']/i);
    if (subVar) {
      const re = /\[([^\]]+)\]\s*(https?:\/\/[^"'\s,;]+)/g;
      let pm;
      while ((pm = re.exec(subVar[1])) !== null) {
        subtitles.push({
          label: pm[1].trim(),
          url: pm[2].trim(),
          referer: new URL(pm[2]).origin + "/",
        });
      }
    }

    // Call API to get video source
    const apiUrl = `https://as-cdn26.top/player/index.php?data=${videoId}&do=getVideo`;
    const apiRes = await fetch(apiUrl, {
      method: "POST",
      headers: {
        ...CHROME_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: embedUrl,
      },
      body: `hash=${videoId}&r=`,
    });

    if (apiRes.ok) {
      try {
        const j = await apiRes.json();
        // Extract subtitles from tracks
        (j.tracks || []).forEach((t) => {
          if ((t.kind === "captions" || t.kind === "subtitles") && t.file) {
            subtitles.push({
              label: t.label || t.language || "Sub",
              url: String(t.file).replace(/\\\//g, "/"),
              referer: "https://as-cdn26.top/",
            });
          }
        });
        // Return direct HLS if available
        if (j.videoSource || j.securedLink) {
          return {
            direct_hls: j.videoSource || j.securedLink,
            qualities: [],
            subtitles,
            poster: j.videoImage || null,
            isIframe: false,
          };
        }
      } catch {
        // JSON parse failed, continue to fallback
      }
    }

    // Fallback: extract m3u8 from player HTML
    const m3u8 = playerHtml.match(/(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i);
    if (m3u8) {
      return {
        direct_hls: m3u8[1],
        qualities: [],
        subtitles,
        isIframe: false,
      };
    }

    return { embedUrl, isIframe: true };
  } catch (e) {
    return { embedUrl, isIframe: true };
  }
}