// ==========================================================================
// Abyss embed decryptor — extracts HLS/mp4 from iframe embeds
// ==========================================================================

import { CHROME_HEADERS } from "../config.js";

/**
 * Resolve Abyss embed URL to direct stream
 * @param {string} embedUrl - iframe embed URL
 * @returns {Object} { direct_hls, direct_url, subtitles, isIframe }
 */
export async function resolveAbyss(embedUrl) {
  try {
    const res = await fetch(embedUrl, {
      headers: CHROME_HEADERS,
      redirect: "follow",
    });
    if (!res.ok) return { embedUrl, isIframe: true };
    const html = await res.text();

    // Try m3u8 first
    const m3u8 = html.match(/(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i);
    if (m3u8) {
      return {
        direct_hls: m3u8[1],
        qualities: [],
        subtitles: [],
        isIframe: false,
      };
    }

    // Try mp4
    const mp4 = html.match(/(https?:\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*)/i);
    if (mp4) {
      return {
        direct_url: mp4[1],
        direct_hls: mp4[1],
        qualities: [],
        subtitles: [],
        isIframe: false,
      };
    }

    return { embedUrl, isIframe: true };
  } catch (e) {
    return { embedUrl, isIframe: true };
  }
}