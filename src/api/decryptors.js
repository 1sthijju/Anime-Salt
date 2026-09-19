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
// Pure JS Dean Edwards p,a,c,k,e,d unpacker (No eval() needed for Workers)
// ---------------------------------------------------------------------------
function baseEncode(num, base) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  if (num < base) {
    return num > 35 ? String.fromCharCode(num + 29) : chars[num];
  }
  return baseEncode(Math.floor(num / base), base) + ((num % base) > 35 ? String.fromCharCode((num % base) + 29) : chars[num % base]);
}

function unpackJs(p, a, c, k) {
  while (c--) {
    if (k[c]) {
      const regex = new RegExp('\\b' + baseEncode(c, a) + '\\b', 'g');
      p = p.replace(regex, k[c]);
    }
  }
  return p;
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
  let direct_hls = json.file || json.url || json.source_file || null;
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
// as-cdn26.top Decryptor (Handles Plaintext, Packed JS, and AES blobs)
// ---------------------------------------------------------------------------
export async function resolveAsCdn26(embedUrl) {
  try {
    const res = await fetch(embedUrl, {
      headers: {
        "Referer": "https://as-cdn26.top/",
        "Origin": "https://as-cdn26.top",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) return { embedUrl, host: "as-cdn26.top", isIframe: true };
    const html = await res.text();

    // 1. Extract global subtitles (often defined outside the packed JS)
    // Format: var playerjsSubtitle = "[English]https://as-cdn30.top/p/...";
    const subtitles = [];
    const subMatch = html.match(/var\s+playerjsSubtitle\s*=\s*"(.*?)";/i);
    if (subMatch) {
      const rawSub = subMatch[1];
      const subRegex = /\[([^\]]+)\](https?:\/\/[^"'\s,;]+)/g;
      let sm;
      while ((sm = subRegex.exec(rawSub)) !== null) {
        subtitles.push({ label: sm[1], url: sm[2] });
      }
      // Fallback if it's just a raw URL without the [Lang] tag
      if (subtitles.length === 0 && rawSub.startsWith("http")) {
        subtitles.push({ label: "Default", url: rawSub });
      }
    }

    // 2. Plaintext m3u8 scan
    const plainM3u8 = html.match(/(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i);
    if (plainM3u8) {
      return { direct_hls: plainM3u8[1], qualities: [], subtitles, host: "as-cdn26.top" };
    }

    // 3. Packed JS unpacking (p,a,c,k,e,d)
    // Safely handles escaped quotes inside the single-quoted strings
    const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\s*\(\s*'((?:\\.|[^'\\])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:\\.|[^'\\])*)'\.split\('\|'\)/);
    if (packedMatch) {
      try {
        const p = packedMatch[1].replace(/\\'/g, "'"); // unescape quotes
        const a = parseInt(packedMatch[2], 10);
        const c = parseInt(packedMatch[3], 10);
        const k = packedMatch[4].replace(/\\'/g, "'").split('|');
        
        const unpacked = unpackJs(p, a, c, k);
        
        // Search the unpacked code for the hidden .m3u8 URL
        const m3u8InUnpacked = unpacked.match(/(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i);
        if (m3u8InUnpacked) {
          return {
            direct_hls: m3u8InUnpacked[1],
            qualities: [],
            subtitles,
            host: "as-cdn26.top"
          };
        }
      } catch (e) {
        console.warn("Failed to unpack JS:", e.message);
      }
    }

    // 4. Encrypted config blob (AES) fallback
    const json = await tryDecryptConfig(html);
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