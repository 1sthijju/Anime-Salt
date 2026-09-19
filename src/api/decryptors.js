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

// Try to locate an encrypted config blob + key/iv in the player page and
// decrypt it (AES-CBC then AES-CTR). Returns parsed JSON or null.
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

    // 1) plaintext m3u8 anywhere
    const plain = html.match(/(https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*)/i);
    if (plain) return { direct_hls: plain[1], qualities: [], subtitles: [], host: "as-cdn26.top" };

    // 2) encrypted config blob (uses crypto.js)
    const json = await tryDecryptConfig(html);
    const picked = pickStreamFromJson(json);
    if (picked) return { ...picked, host: "as-cdn26.top" };

    // 3) known ajax-style endpoint referenced by the player
    const ajax = html.match(/["'](\/(?:encrypt-)?(?:ajax|api)[^"']*)["']/i);
    if (ajax) {
      try {
        const u = new URL(ajax[1], "https://as-cdn26.top").toString();
        const r2 = await fetch(u, { headers: { "Referer": embedUrl, "X-Requested-With": "XMLHttpRequest" } });
        if (r2.ok) {
          const j2 = await r2.json().catch(() => null);
          const p2 = pickStreamFromJson(j2);
          if (p2) return { ...p2, host: "as-cdn26.top" };
        }
      } catch (e) { /* ignore */ }
    }

    return { embedUrl, host: "as-cdn26.top", isIframe: true };
  } catch (e) {
    return { embedUrl, host: "as-cdn26.top", isIframe: true, error: e.message };
  }
}

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