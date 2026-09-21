// ==========================================================================
// AbyssPlayer decryptor (abyssplayer.com / player.abyssplayer.com)
//
// Hydrax-fork using JWPlayer + signed MP4 streams. Decrypt chain:
//   1. GET embed page with Origin/Referer = https://playhydrax.com
//   2. Regex  const datas = "<base64+binary>"   (plural "datas")
//   3. POST https://enc-dec.app/api/dec-abyss  body {"text":"<raw base64>"}
//   4. JSON → result.sources[]  (each: url / type / codec / size / status)
//
// FIX: playback referer is the FULL player page URL
// (https://player.abyssplayer.com/<slug>) — sssrr.org hotlink protection
// validates the page-level referer, not just the origin.
// ==========================================================================

const HYDRAX_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

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
    // 1) embed page (short.icu → player.abyssplayer.com rewrite happens upstream)
    const pageRes = await fetch(embedUrl, {
      headers: PAGE_HEADERS,
      redirect: "follow",
    });
    if (!pageRes.ok) return { embedUrl, isIframe: true, debug: `page ${pageRes.status}` };
    const page = await pageRes.text();

    // FINAL url after redirects = the player page = required playback referer
    const pageUrl = pageRes.url || embedUrl;

    // 2) encrypted payload:  const datas = "...."
    const m = page.match(/const\s+datas\s*=\s*"([^"]+)"/);
    if (!m || !m[1]) return { embedUrl, isIframe: true, debug: "no const datas= in page" };
    const encoded = m[1];

    // 3) decrypt via public dec-abyss API
    const decRes = await fetch(DECRYPT_API, {
      method: "POST",
      headers: {
        "User-Agent": HYDRAX_UA,
        Origin: "https://playhydrax.com",
        Referer: "https://playhydrax.com/",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ text: encoded }),
    });
    if (!decRes.ok) return { embedUrl, isIframe: true, debug: `decrypt HTTP ${decRes.status}` };

    const dec = await decRes.json();
    const sources = (dec && dec.result && dec.result.sources) || (dec && dec.sources) || [];
    if (!sources.length) return { embedUrl, isIframe: true, debug: "no sources in decrypt response" };

    // 4) pick best quality — 1080p h264 → 720p h264 → largest file
    const usable = sources.filter((s) => s && s.url && s.status !== false);
    if (!usable.length) return { embedUrl, isIframe: true, debug: "no usable sources" };
    const h264 = usable.filter((s) => /h264/i.test(s.codec || ""));
    const best =
      h264.find((s) => /1080p/i.test(s.type || "")) ||
      h264.find((s) => /720p/i.test(s.type || "")) ||
      usable.slice().sort((a, b) => (b.size || 0) - (a.size || 0))[0];

    return {
      // MP4, not HLS — but direct_hls is the unified "playable URL" field
      direct_hls: best.url,
      qualities: usable.map((s) => ({
        label: `${s.type || "unknown"}${s.codec ? " " + s.codec : ""}`,
        url: s.url,
        bandwidth: Math.round((s.size || 0) / 1000),
        resolution: s.type || null,
      })),
      subtitles: [],
      audio_languages: [],
      subtitle_languages: [],
      poster: null,
      referer: pageUrl, // ← FULL player page URL (fixes sssrr.org 403)
      isIframe: false,
    };
  } catch (e) {
    return { embedUrl, isIframe: true, debug: e.message };
  }
}