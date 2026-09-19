import { decryptAES } from "./crypto.js";

export function normalizeAbyssUrl(url) {
  if (!url) return "";
  if (url.startsWith("//")) return "https:" + url;
  return url;
}

const enc = new TextEncoder();

function b64ToBytes(b64) {
  const clean = b64.replace(/\s/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// ---------------------------------------------------------------------------
// AES Blob decryption (for players that hide config in encrypted JSON)
// ---------------------------------------------------------------------------
async function tryDecryptConfig(html) {
  const blobMatch =
    html.match(/(?:var|const|let)\s+\w*(?:encrypted|cipher|data|config)\w*\s*=\s*["']([A-Za-z0-9+\/=_-]{64,})["']/i) ||
    html.match(/["']data["']\s*:\s*["']([A-Za-z0-9+\/=_-]{64,})["']/i);
  if (!blobMatch) return null;

  const keyMatch = html.match(/(?:key|KEY)\s*[:=]\s*["']([A-Za-z0-9]{16,32})["']/);
  const ivMatch  = html.match(/(?:iv|IV)\s*[:=]\s*["']([A-Za-z0-9]{16,32})["']/);
  if (!keyMatch || !ivMatch) return null;

  const keyStr = keyMatch[1];
  const ivStr = ivMatch[1];
  const key = /^[0-9a-fA-F]+$/.test(keyStr) && keyStr.length % 2 === 0 ? hexToBytes(keyStr) : enc.encode(keyStr);
  const iv  = /^[0-9a-fA-F]+$/.test(ivStr) && ivStr.length % 2 === 0 ? hexToBytes(ivStr) : enc.encode(ivStr);

  const bytes = b64ToBytes(blobMatch[1]);
  for (const mode of ["CBC", "CTR"]) {
    try {
      const plain = await decryptAES(bytes, key, iv, mode);
      if (plain && plain.trim().startsWith("{")) return JSON.parse(plain);
    } catch (e) { /* try next mode */ }
  }
  return null;
}

function pickStreamFromJson(json) {
  if (!json) return null;
  const sources = json.source || json.sources || json.streams || json.qualities || null;
  let direct_hls = json.file || json.url || json.source_file || json.videoSource || json.securedLink || null;
  const qualities = [];
  if (Array.isArray(sources)) {
    for (const s of sources) {
      const u = s.file || s.url || s.src;
      if (!u) continue;
      if (/\.m3u8/i.test(u) || (s.type || "").includes("hls")) { if (!direct_hls) direct_hls = u; }
      else qualities.push({ label: s.label || s.quality || "auto", url: u });
    }
  }
  if (!direct_hls && qualities.length) direct_hls = qualities[0].url;
  if (!direct_hls) return null;
  const subtitles = Array.isArray(json.tracks)
    ? json.tracks.filter(t => t.kind === "captions" || t.kind === "subtitles")
        .map(t => ({ label: t.label || t.language || "Sub", url: t.file, referer: t.referer || "" }))
    : (json.subtitles || []);
  return { direct_hls, qualities, subtitles };
}

// ---------------------------------------------------------------------------
// Get the origin referer for a URL (CDN just checks origin matches)
// ---------------------------------------------------------------------------
function getOriginReferer(url) {
  try {
    return new URL(url).origin + "/";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// as-cdn26.top Decryptor (API-based + fallback to packed JS)
// ---------------------------------------------------------------------------
export async function resolveAsCdn26(embedUrl) {
  try {
    // Extract video ID from URL
    const idMatch = embedUrl.match(/\/video\/([a-f0-9]+)/);
    if (!idMatch) return { embedUrl, host: "as-cdn26.top", isIframe: true };
    const videoId = idMatch[1];

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://as-cdn26.top/",
      "Origin": "https://as-cdn26.top",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    };

    // Step 1: Fetch player page to get cookies
    const playerRes = await fetch(embedUrl, { headers });
    const cookies = playerRes.headers.get('set-cookie') || '';
    const playerHtml = await playerRes.text();

    // Step 2: Extract subtitles — use the subtitle URL's own origin as referer
    // (the CDN just needs origin match, not the full player page URL)
    const subtitles = [];
    const pushSub = (label, url) => {
      if (!url || url.startsWith("data:")) return;
      url = url.replace(/\\\//g, "/");   // unescape JSON slashes
      if (url.startsWith("//")) url = "https:" + url;
      if (!subtitles.some(s => s.url === url)) {
        subtitles.push({
          label: label || "Sub",
          url,
          referer: getOriginReferer(url),   // match the CDN hosting the file
        });
      }
    };

    const subVarMatch = playerHtml.match(/var\s+playerjsSubtitle\s*=\s*["']([^"']*)["']/i);
    if (subVarMatch) {
      const raw = subVarMatch[1].replace(/\\\//g, "/");
      // Pattern: [Label]https://... or [Label] https://...
      const pairRe = /\[([^\]]+)\]\s*(https?:\/\/[^"'\s,;]+)/g;
      let pm, found = 0;
      while ((pm = pairRe.exec(raw)) !== null) {
        pushSub(pm[1].trim(), pm[2].trim());
        found++;
      }
      if (!found && raw.trim().startsWith("http")) pushSub("Default", raw.trim());
    }

    // Step 3: Call API to get stream URL
    const apiUrl = `https://as-cdn26.top/player/index.php?data=${videoId}&do=getVideo`;
    const apiHeaders = {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": embedUrl,
      "Cookie": cookies
    };
    const body = `hash=${videoId}&r=`;

    const apiRes = await fetch(apiUrl, {
      method: "POST",
      headers: apiHeaders,
      body: body
    });

    if (apiRes.ok) {
      try {
        const jdata = await apiRes.json();
        
        // Extract subtitles/tracks from API JSON
        if (Array.isArray(jdata.tracks)) {
          for (const t of jdata.tracks) {
            if (t && (t.kind === "captions" || t.kind === "subtitles") && t.file) {
              pushSub(t.label || t.language || "Sub", String(t.file));
            }
          }
        }
        if (Array.isArray(jdata.subtitles)) {
          for (const t of jdata.subtitles) {
            pushSub(t.label || t.language || "Sub", String(t.file || t.url));
          }
        }
        
        // The API returns the decrypted URL directly
        if (jdata.videoSource || jdata.securedLink) {
          return {
            direct_hls: jdata.videoSource || jdata.securedLink,
            qualities: [],
            subtitles,
            poster: jdata.videoImage || null,
            host: "as-cdn26.top",
            isIframe: false
          };
        }
      } catch (e) {
        console.warn("API JSON parse failed:", e.message);
      }
    }

    // Step 4: Fallback - try plaintext m3u8 scan
    const plainM3u8 = playerHtml.match(/(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i);
    if (plainM3u8) {
      return { direct_hls: plainM3u8[1], qualities: [], subtitles, host: "as-cdn26.top" };
    }

    // Step 5: Fallback - encrypted config blob (AES)
    const json = await tryDecryptConfig(playerHtml);
    const picked = pickStreamFromJson(json);
    if (picked) return { ...picked, subtitles: [...subtitles, ...(picked.subtitles || [])], host: "as-cdn26.top" };

    return { embedUrl, host: "as-cdn26.top", isIframe: true };
  } catch (e) {
    return { embedUrl, host: "as-cdn26.top", isIframe: true, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Abyss Family Decryptor (short.icu, abysscdn, etc.)
// ---------------------------------------------------------------------------
export async function resolveAbyss(embedUrl) {
  try {
    const url = normalizeAbyssUrl(embedUrl);
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
    });
    if (!res.ok) return { embedUrl: url, host: "abyss", isIframe: true };
    const html = await res.text();

    const m3u8 = html.match(/(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i);
    if (m3u8) return { direct_hls: m3u8[1], qualities: [], subtitles: [], host: "abyss" };

    const mp4 = html.match(/(https?:\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*)/i);
    if (mp4) return { direct_url: mp4[1], host: "abyss" };

    const json = await tryDecryptConfig(html);
    const picked = pickStreamFromJson(json);
    if (picked) return { ...picked, host: "abyss" };

    return { embedUrl: url, host: "abyss", isIframe: true };
  } catch (e) {
    return { embedUrl, host: "abyss", isIframe: true, error: e.message };
  }
}