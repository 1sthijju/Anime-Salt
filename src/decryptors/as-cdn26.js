// ==========================================================================
// as-cdn26.top decryptor — extracts HLS + audio languages + subtitles
// ==========================================================================

import { CHROME_HEADERS } from "../config.js";

/**
 * Parse HLS master playlist to extract audio/subtitle variants
 */
function parseMasterPlaylist(m3u8Url, m3u8Content) {
  const lines = m3u8Content.split("\n");
  const audioTracks = [];
  const subtitleTracks = [];
  const qualities = [];

  let currentMedia = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Parse #EXT-X-MEDIA for audio/subtitle tracks
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const type = line.match(/TYPE=([^,]+)/)?.[1];
      const groupId = line.match(/GROUP-ID="([^"]+)"/)?.[1];
      const name = line.match(/NAME="([^"]+)"/)?.[1];
      const lang = line.match(/LANGUAGE="([^"]+)"/)?.[1];
      const uri = line.match(/URI="([^"]+)"/)?.[1];
      const isDefault = line.includes("DEFAULT=YES");
      const isAutoSelect = line.includes("AUTOSELECT=YES");

      if (type === "AUDIO" && uri) {
        audioTracks.push({
          language: lang || name || "unknown",
          name: name || lang || "Audio",
          url: uri.startsWith("http") ? uri : new URL(uri, m3u8Url).href,
          isDefault,
          isAutoSelect,
        });
      } else if (type === "SUBTITLES" && uri) {
        subtitleTracks.push({
          language: lang || name || "unknown",
          name: name || lang || "Subtitles",
          url: uri.startsWith("http") ? uri : new URL(uri, m3u8Url).href,
          isDefault,
          isAutoSelect,
        });
      }
    }

    // Parse #EXT-X-STREAM-INF for video qualities
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const bandwidth = parseInt(line.match(/BANDWIDTH=(\d+)/)?.[1] || "0", 10);
      const resolution = line.match(/RESOLUTION=(\d+x\d+)/)?.[1];
      const audio = line.match(/AUDIO="([^"]+)"/)?.[1];
      const subs = line.match(/SUBTITLES="([^"]+)"/)?.[1];

      // Next line should be the stream URL
      if (i + 1 < lines.length && !lines[i + 1].startsWith("#")) {
        const streamUrl = lines[i + 1].trim();
        qualities.push({
          label: resolution || `${Math.round(bandwidth / 1000)}k`,
          bandwidth,
          resolution,
          url: streamUrl.startsWith("http") ? streamUrl : new URL(streamUrl, m3u8Url).href,
          audioGroup: audio,
          subtitlesGroup: subs,
        });
      }
    }
  }

  return { audioTracks, subtitleTracks, qualities };
}

/**
 * Fetch and parse the HLS master playlist
 */
async function fetchMasterPlaylist(m3u8Url, referer) {
  try {
    const res = await fetch(m3u8Url, {
      headers: {
        ...CHROME_HEADERS,
        Referer: referer,
        Accept: "*/*",
      },
    });
    if (!res.ok) return null;
    const content = await res.text();
    return parseMasterPlaylist(m3u8Url, content);
  } catch (e) {
    return null;
  }
}

/**
 * Resolve as-cdn26 embed URL to direct HLS stream with full metadata
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
        const label = pm[1].trim();
        const url = pm[2].trim();
        // Only add if it looks like a subtitle file (not an image)
        if (/\.(vtt|srt|ass|ssa|txt)(\?|$)/i.test(url)) {
          subtitles.push({
            label,
            url,
            referer: new URL(url).origin + "/",
          });
        }
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

    let directHls = null;
    let poster = null;

    if (apiRes.ok) {
      try {
        const j = await apiRes.json();

        // Extract subtitles from tracks (filter out non-subtitle tracks)
        (j.tracks || []).forEach((t) => {
          if ((t.kind === "captions" || t.kind === "subtitles") && t.file) {
            const fileUrl = String(t.file).replace(/\\\//g, "/");
            // Only add if it looks like a subtitle file
            if (/\.(vtt|srt|ass|ssa|txt)(\?|$)/i.test(fileUrl)) {
              subtitles.push({
                label: t.label || t.language || "Sub",
                url: fileUrl,
                referer: "https://as-cdn26.top/",
              });
            }
          }
        });

        if (j.videoSource || j.securedLink) {
          directHls = j.videoSource || j.securedLink;
          poster = j.videoImage || null;
        }
      } catch {
        // JSON parse failed, continue to fallback
      }
    }

    // Fallback: extract m3u8 from player HTML
    if (!directHls) {
      const m3u8 = playerHtml.match(/(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i);
      if (m3u8) {
        directHls = m3u8[1];
      }
    }

    if (!directHls) {
      return { embedUrl, isIframe: true };
    }

    // Fetch and parse the master playlist to get audio/subtitle variants
    const referer = "https://as-cdn26.top/";
    const masterData = await fetchMasterPlaylist(directHls, referer);

    // Deduplicate subtitles
    const seenSubUrls = new Set();
    const uniqueSubtitles = subtitles.filter((s) => {
      if (seenSubUrls.has(s.url)) return false;
      seenSubUrls.add(s.url);
      return true;
    });

    return {
      direct_hls: directHls,
      qualities: masterData?.qualities || [],
      subtitles: uniqueSubtitles,
      audio_languages: masterData?.audioTracks || [],
      subtitle_languages: masterData?.subtitleTracks || [],
      poster,
      referer,
      isIframe: false,
    };
  } catch (e) {
    return { embedUrl, isIframe: true };
  }
}