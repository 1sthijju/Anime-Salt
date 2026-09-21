// ==========================================================================
// AbyssPlayer decryptor (abyssplayer.com / player.abyssplayer.com)
// Hydrax-based host. Decrypt chain (verified via oce extractor config):
//   1. GET embed page with Origin/Referer = https://playhydrax.com
//   2. Regex  const data = "<encrypted>"
//   3. POST https://enc-dec.app/api/dec-abyss  body {"text":"<encrypted>"}
//   4. JSON → result.sources[].url  (m3u8 / mp4)
// Playback referer: https://abyssplayer.com/
// ==========================================================================

import { CHROME_HEADERS } from "../config.js";

const HYDRAX_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

const PAGE_HEADERS = {
  "User-Agent": HYDRAX_UA,
  Origin: "https://playhydrax.com",
  Referer: "https://playhydrax.com/",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const DECRYPT_API = "https://enc-dec.app/api/dec-abyss";

export async function resolveAbyss(embedUrl) {
  try {
    // 1) embed page (follows short.icu → player.abyssplayer.com automatically)
    const pageRes = await fetch(embedUrl, {
      headers: PAGE_HEADERS,
      redirect: "follow",
    });
    if (!pageRes.ok) return { embedUrl, isIframe: true };
    const page = await pageRes.text();

    // 2) encrypted payload:  const data = "...."
    const m =
      page.match(/(?:const|var|let)\s+data\s*=\s*"([^"]*)"/) ||
      page.match(/const\s+data\s*=\s*'([^']*)'/);
    if (!m || !m[1]) return { embedUrl, isIframe: true };
    const encrypted = m[1];

    // 3) decrypt via public dec-abyss API
    const decRes = await fetch(DECRYPT_API, {
      method: "POST",
      headers: {
        "User-Agent": HYDRAX_UA,
        Origin: "https://playhydrax.com",
        Referer: "https://playhydrax.com/",
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
      },
      body: JSON.stringify({ text: encrypted }),
    });
    if (!decRes.ok) return { embedUrl, isIframe: true, debug: `decrypt HTTP ${decRes.status}` };

    let dec;
    try { dec = await decRes.json(); }
    catch { return { embedUrl, isIframe: true, debug: "decrypt non-JSON" }; }

    // 4) sources → prefer m3u8
    const sources = dec?.result?.sources || dec?.sources || dec?.result || [];
    const urls = (Array.isArray(sources) ? sources : [])
      .map((s) => (typeof s === "string" ? s : s && s.url))
      .filter((u) => typeof u === "string" && u);
    if (!urls.length) return { embedUrl, isIframe: true, debug: "no sources in decrypt response" };

    const hls = urls.find((u) => /\.m3u8(\?|$)/i.test(u)) || urls[0];

    return {
      direct_hls: hls,
      qualities: urls.map((u, i) => ({ label: `Source ${i + 1}`, url: u })),
      subtitles: [],
      audio_languages: [],
      subtitle_languages: [],
      poster: null,
      referer: "https://abyssplayer.com/",   // playback referer per extractor config
      isIframe: false,
    };
  } catch (e) {
    return { embedUrl, isIframe: true, debug: e.message };
  }
}