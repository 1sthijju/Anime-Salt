import { CHROME_HEADERS, AJAX_HEADERS } from "./config.js";
import { aesCtrTransform } from "./crypto.js";
import { fetchPage } from "./net.js";

export function normalizeAbyssUrl(url) {
  try {
    const u = new URL(url);
    const legacyHosts = ["short.icu", "short.ink", "abysscdn.com", "hydraxcdn.biz", "embedplayabyss.top"];
    if (legacyHosts.includes(u.hostname)) {
      const slug = u.pathname.split("/").filter(Boolean).pop() || u.searchParams.get("v") || "";
      if (slug) return `https://abyssplayer.com/${slug}`;
    }
    return url;
  } catch (e) { return url; }
}

export async function resolveAsCdn26(embedUrl) {
  const videoId = new URL(embedUrl).pathname.split('/').pop();
  
  // Fetch the embed page HTML to extract subtitles
  const sessionRes = await fetch(embedUrl, { headers: CHROME_HEADERS });
  const embedHtml = await sessionRes.text();
  
  // Extract session cookie
  let cookie = "";
  const setCookies = sessionRes.headers.getSetCookie?.() || [];
  for (const c of setCookies) {
    const match = c.match(/fireplayer_player=([^;]+)/);
    if (match) { cookie = `fireplayer_player=${match[1]}`; break; }
  }
  
  // Extract subtitles from playerjsSubtitle variable
  // Format: "[English]https://as-cdn28.top/p/...jpg" (disguised as JPG, actually SRT)
  const subtitles = [];
  const subMatch = embedHtml.match(/playerjsSubtitle\s*=\s*"([^"]*)"/i);
  if (subMatch && subMatch[1]) {
    const rawSubtitles = subMatch[1];
    const pairRegex = /\[([^\]]+)\](https?:\/\/[^"'\s\\]+)/g;
    let match;
    while ((match = pairRegex.exec(rawSubtitles)) !== null) {
      subtitles.push({ 
        label: match[1], 
        url: match[2],
        referer: embedUrl  // Track the embed URL as the required referer
      });
    }
  }
  
  // Get stream URL via AJAX
  const ajaxRes = await fetch(`https://as-cdn26.top/player/index.php?data=${videoId}&do=getVideo`, {
    method: 'POST',
    headers: { 
      ...AJAX_HEADERS, 
      "Cookie": cookie, 
      "Referer": embedUrl, 
      "Origin": "https://as-cdn26.top", 
      "Content-Type": "application/x-www-form-urlencoded" 
    },
    body: `hash=${videoId}&r=https://animesalt.cx/`
  });
  
  const data = await ajaxRes.json();
  if (!data.securedLink) throw new Error("Failed to get as-cdn26 token");
  
  return { 
    host: "as-cdn26.top", 
    source_type: "hls", 
    direct_hls: data.securedLink, 
    subtitles,
    tracks: data.tracks || [] 
  };
}

export async function resolveAbyss(embedUrl) {
  embedUrl = normalizeAbyssUrl(embedUrl);
  const html = await fetchPage(embedUrl);
  const datasMatch = html.match(/(?:const|var)\s+datas\s*=\s*"([^"]+)"/);
  if (!datasMatch) throw new Error("No Abyss payload");
  const rawBytes = Uint8Array.from(atob(datasMatch[1]), c => c.charCodeAt(0));
  const payload = JSON.parse(new TextDecoder().decode(rawBytes));
  const seed = `${payload.user_id}:${payload.slug}:${payload.md5_id}`;
  const mediaBytes = Uint8Array.from(payload.media, c => c.charCodeAt(0));
  const decrypted = await aesCtrTransform(mediaBytes, seed, 'decrypt');
  const mediaJson = JSON.parse(new TextDecoder().decode(decrypted));
  const qualities = [];
  const sources = mediaJson.mp4?.sources || [];
  for (const src of sources) {
    if (src.file) {
      qualities.push({ resolution: src.label || "Unknown", url: src.file });
    } else if (src.path && src.size && src.sub) {
      const pathBytes = new TextEncoder().encode(`/mp4/${payload.md5_id}/${src.res_id}/${src.size}?v=${payload.slug}`);
      const encPath = await aesCtrTransform(pathBytes, src.size.toString(), 'encrypt');
      const soraToken = btoa(btoa(String.fromCharCode(...encPath)));
      const domain = mediaJson.mp4.domains?.find(d => src.sub.includes(d)) || "abysscdn.com";
      qualities.push({ resolution: src.label, size: src.size, url: `https://${domain}/sora/${src.size}/${soraToken}` });
    }
  }
  return { host: "abyssplayer.com", source_type: "mp4", qualities };
}