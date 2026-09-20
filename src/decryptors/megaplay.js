// ==========================================================================
// Megaplay.buzz decryptor v2 — AES-CBC "enc" field → direct HLS
// Hotlink note: fetch.nexabloom.top ONLY accepts Referer/Origin = megaplay.buzz
// ==========================================================================

import { CHROME_HEADERS } from "../config.js";

const MEGAPLAY_DECRYPT_KEY = "i?LMTAx0Q6,:}50U";
const MEGAPLAY_REFERER = "https://megaplay.buzz/";
const MEGAPLAY_ORIGIN  = "https://megaplay.buzz";

/** AES-256-CBC decrypt: first 16 bytes = IV, PKCS7 padding, URL-safe base64 */
async function decryptMegaplay(encData) {
  let b64 = encData.replace(/-/g, "+").replace(/_/g, "/");
  const pad = 4 - (b64.length % 4);
  if (pad !== 4) b64 += "=".repeat(pad);

  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, 16);
  const ciphertext = raw.slice(16);

  const keyBytes = new Uint8Array(32);
  keyBytes.set(new TextEncoder().encode(MEGAPLAY_DECRYPT_KEY).slice(0, 32));

  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, ciphertext);
  const text = new TextDecoder().decode(plain);

  // text looks like:  /fetch.nexabloom.top/anime/…/master.m3u8"}
  const m = text.match(/\/([^\s"}]+\.m3u8[^\s"}]*)/i);
  if (m) return "https://" + m[1];
  const p = text.match(/\/[^\s"}]+/);
  return p ? "https:/" + p[0] : text.trim();
}

/** Parse master playlist for qualities + audio/subtitle renditions */
async function parseHLSQualities(m3u8Url) {
  try {
    const res = await fetch(m3u8Url, {
      headers: {
        ...CHROME_HEADERS,
        Referer: MEGAPLAY_REFERER,          // ← the fix
        Origin: MEGAPLAY_ORIGIN,            // ← the fix
        Accept: "*/*",
      },
    });
    if (!res.ok) return { qualities: [], audioTracks: [], subtitleTracks: [] };
    const lines = (await res.text()).split("\n");

    const qualities = [], audioTracks = [], subtitleTracks = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith("#EXT-X-MEDIA:")) {
        const type = line.match(/TYPE=([^,]+)/)?.[1];
        const name = line.match(/NAME="([^"]+)"/)?.[1];
        const lang = line.match(/LANGUAGE="([^"]+)"/)?.[1];
        const uri  = line.match(/URI="([^"]+)"/)?.[1];
        if (!uri) continue;
        const abs = uri.startsWith("http") ? uri : new URL(uri, m3u8Url).href;
        const entry = {
          language: lang || name || "unknown",
          name: name || lang || type,
          url: abs,
          isDefault: line.includes("DEFAULT=YES"),
          isAutoSelect: line.includes("AUTOSELECT=YES"),
        };
        if (type === "AUDIO") audioTracks.push(entry);
        else if (type === "SUBTITLES") subtitleTracks.push(entry);
      }

      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const bandwidth = parseInt(line.match(/BANDWIDTH=(\d+)/)?.[1] || "0", 10);
        const resolution = line.match(/RESOLUTION=(\d+x\d+)/)?.[1];
        const nxt = lines[i + 1]?.trim();
        if (nxt && !nxt.startsWith("#")) {
          qualities.push({
            label: resolution || `${Math.round(bandwidth / 1000)}k`,
            bandwidth,
            resolution,
            url: nxt.startsWith("http") ? nxt : new URL(nxt, m3u8Url).href,
            audioGroup: line.match(/AUDIO="([^"]+)"/)?.[1],
            subtitlesGroup: line.match(/SUBTITLES="([^"]+)"/)?.[1],
          });
        }
      }
    }
    return { qualities, audioTracks, subtitleTracks };
  } catch {
    return { qualities: [], audioTracks: [], subtitleTracks: [] };
  }
}

export async function resolveMegaplay(embedUrl) {
  try {
    const idMatch = embedUrl.match(/\/s-\d+\/(\d+)/);
    if (!idMatch) return null;

    // 1) embed page → data-id
    const pageRes = await fetch(embedUrl, {
      headers: { ...CHROME_HEADERS, Referer: "https://animesalt.cx/" },
    });
    const html = await pageRes.text();
    const dataId = html.match(/data-id="(\d+)"/)?.[1];
    if (!dataId) return null;

    // 2) sources API → { enc, tracks, intro, outro }
    const apiRes = await fetch(`https://megaplay.buzz/stream/getSourcesNew?id=${dataId}`, {
      headers: {
        ...CHROME_HEADERS,
        Referer: embedUrl,
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/plain, */*",
      },
    });
    if (!apiRes.ok) return null;
    const data = await apiRes.json();
    if (!data || !data.enc) return null;

    // 3) decrypt → master m3u8
    const m3u8Url = await decryptMegaplay(data.enc);

    // 4) parse manifest WITH the whitelisted referer
    const hls = await parseHLSQualities(m3u8Url);

    const subtitles = (data.tracks || [])
      .filter((t) => t.kind === "captions" || t.kind === "subtitles" || /\.vtt/i.test(t.file || ""))
      .map((t) => ({ label: t.label || "Sub", url: t.file, referer: MEGAPLAY_REFERER }));

    return {
      isIframe: false,
      direct_hls: m3u8Url,
      referer: MEGAPLAY_REFERER,            // ← stream/proxy will use this now
      qualities: hls.qualities,
      audio_languages: hls.audioTracks,
      subtitle_languages: hls.subtitleTracks,
      subtitles,
      poster: null,
      intro: data.intro || null,
      outro: data.outro || null,
      embedUrl,
    };
  } catch (e) {
    console.error("[Megaplay]", e.message);
    return null;
  }
}