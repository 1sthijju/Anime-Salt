import { CHROME_HEADERS, AJAX_HEADERS } from "./config.js";
import { aesCtrTransform } from "./crypto.js";
import { fetchPage, cachedJSON } from "./net.js";

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
  const sessionRes = await fetch(embedUrl, { headers: CHROME_HEADERS });
  const embedHtml = await sessionRes.text();

  let cookie = "";
  const setCookies = sessionRes.headers.getSetCookie?.() || [];
  for (const c of setCookies) {
    const match = c.match(/fireplayer_player=([^;]+)/);
    if (match) { cookie = `fireplayer_player=${match[1]}`; break; }
  }

  const subtitles = [];
  const subMatch = embedHtml.match(/playerjsSubtitle\s*=\s*"([^"]*)"/i);
  if (subMatch && subMatch[1]) {
    const pairRegex = /\[([^\]]+)\](https?:\/\/[^"'\s\\]+)/g;
    let match;
    while ((match = pairRegex.exec(subMatch[1])) !== null) {
      subtitles.push({ label: match[1], url: match[2], referer: embedUrl });
    }
  }

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

// ---------------------------------------------------------------------------
// Abyss resolver with full redirector-chain probing
// ---------------------------------------------------------------------------
function extractDatas(text) {
  const m =
    text.match(/(?:var|let|const)\s+datas\s*=\s*["']([^"']+)["']/i) ||
    text.match(/["']datas["']\s*:\s*["']([^"']+)["']/i);
  return m ? m[1] : null;
}

async function abyssFetch(url, cookie) {
  const headers = { ...CHROME_HEADERS, "Referer": "https://animesalt.cx/" };
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(url, { headers, redirect: "follow" });
  const text = await res.text();
  return { text, finalUrl: res.url, setCookies: res.headers.getSetCookie?.() || [], ok: res.ok };
}

function buildQualities(payload) {
  const seed = `${payload.user_id}:${payload.slug}:${payload.md5_id}`;
  const mediaBytes = Uint8Array.from(payload.media, c => c.charCodeAt(0));
  return aesCtrTransform(mediaBytes, seed, 'decrypt').then(decrypted => {
    const mediaJson = JSON.parse(new TextDecoder().decode(decrypted));
    const qualities = [];
    const sources = mediaJson.mp4?.sources || [];
    for (const src of sources) {
      if (src.file) {
        qualities.push({ resolution: src.label || "Unknown", url: src.file });
      } else if (src.path && src.size && src.sub) {
        const pathBytes = new TextEncoder().encode(`/mp4/${payload.md5_id}/${src.res_id}/${src.size}?v=${payload.slug}`);
        return aesCtrTransform(pathBytes, src.size.toString(), 'encrypt').then(() => qualities); // placeholder, replaced below
      }
    }
    return { mediaJson, qualities, payload };
  });
}

async function decryptPayload(payload) {
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

export async function resolveAbyss(embedUrl) {
  let slug = "";
  try {
    const u = new URL(embedUrl);
    slug = u.pathname.split("/").filter(Boolean).pop() || u.searchParams.get("v") || "";
  } catch (e) {}
  if (!slug) throw new Error("No Abyss slug");

  // Probe order: original redirector first (follows real chain), then known hosts
  const candidates = [
    embedUrl,
    `https://abyssplayer.com/${slug}`,
    `https://abysscdn.com/?v=${slug}`,
    `https://abysscdn.com/${slug}`,
    `https://embedplayabyss.top/${slug}`,
    `https://hydraxcdn.biz/${slug}`,
  ];

  return await cachedJSON(`abyss:${slug}`, async () => {
    for (const url of candidates) {
      try {
        let r = await abyssFetch(url);
        if (/Just a moment|cf-browser-verification/i.test(r.text)) continue;

        let b64 = extractDatas(r.text);

        // Session-cookie retry on the final URL
        if (!b64 && r.setCookies.length) {
          const cookie = r.setCookies.map(c => c.split(";")[0]).join("; ");
          const retry = await abyssFetch(r.finalUrl || url, cookie);
          b64 = extractDatas(retry.text);
        }

        if (b64) {
          const payload = JSON.parse(
            new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))
          );
          return await decryptPayload(payload);
        }
      } catch (e) { /* try next candidate */ }
    }
    throw new Error("No Abyss payload");
  }, 30 * 60);
}