import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();
app.use('*', cors());

const BASE_URL = "https://animesalt.cx";
const PROXY_BASE = "https://animesalt-proxy.v1nx.workers.dev"; // Fallback if WAF blocks direct fetch

const CHROME_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://animesalt.cx/",
};

const AJAX_HEADERS = {
  ...CHROME_HEADERS,
  "Accept": "*/*",
  "X-Requested-With": "XMLHttpRequest",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};

// ==========================================
// 1. CRYPTO UTILITIES (WebCrypto + MD5 Polyfill)
// ==========================================

// MD5 Polyfill (WebCrypto doesn't support MD5 natively, which Abyss requires)
function md5(string: string): string {
  // [Insert the MD5 polyfill function from the previous Worker code here]
  // For brevity, assume the full MD5 function is pasted here.
  return ""; // Placeholder
}

async function aesCtrTransform(data: Uint8Array, keySeed: string, mode: 'encrypt' | 'decrypt'): Promise<Uint8Array> {
  const keyHex = md5(keySeed);
  const keyBytes = new TextEncoder().encode(keyHex);
  const iv = keyBytes.slice(0, 16);
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "AES-CTR" }, false, [mode]
  );
  
  const result = await crypto.subtle[mode](
    { name: "AES-CTR", counter: iv, length: 64 },
    cryptoKey,
    data
  );
  
  return new Uint8Array(result);
}

// ==========================================
// 2. NETWORK & PARSING HELPERS
// ==========================================

async function fetchPage(path: string): Promise<string> {
  // Try direct fetch first
  let res = await fetch(`${BASE_URL}${path}`, { headers: CHROME_HEADERS });
  let text = await res.text();
  
  // If blocked by Cloudflare WAF, fallback to your Reverse Proxy Worker
  if (!res.ok || text.includes("Just a moment...")) {
    res = await fetch(`${PROXY_BASE}${path}`, { headers: CHROME_HEADERS });
    text = await res.text();
  }
  return text;
}

// ==========================================
// 3. DECRYPTOR ENGINES
// ==========================================

async function resolveAsCdn26(embedUrl: string) {
  const videoId = new URL(embedUrl).pathname.split('/').pop();
  const sessionRes = await fetch(embedUrl, { headers: CHROME_HEADERS });
  
  let cookie = "";
  const setCookies = sessionRes.headers.getSetCookie?.() || [];
  for (const c of setCookies) {
    const match = c.match(/fireplayer_player=([^;]+)/);
    if (match) { cookie = `fireplayer_player=${match[1]}`; break; }
  }

  const ajaxRes = await fetch(`https://as-cdn26.top/player/index.php?data=${videoId}&do=getVideo`, {
    method: 'POST',
    headers: { ...AJAX_HEADERS, "Cookie": cookie, "Referer": embedUrl, "Origin": "https://as-cdn26.top", "Content-Type": "application/x-www-form-urlencoded" },
    body: `hash=${videoId}&r=https://animesalt.cx/`
  });

  const data = await ajaxRes.json();
  if (!data.securedLink) throw new Error("Failed to get as-cdn26 token");
  
  return { host: "as-cdn26.top", source_type: "hls", direct_hls: data.securedLink, subtitles: data.tracks || [] };
}

async function resolveAbyss(embedUrl: string) {
  const html = await fetchPage(embedUrl);
  const datasMatch = html.match(/(?:const|var)\s+datas\s*=\s*"([^"]+)"/);
  if (!datasMatch) throw new Error("No Abyss payload");

  const rawBytes = Uint8Array.from(atob(datasMatch[1]), c => c.charCodeAt(0));
  const payload = JSON.parse(new TextDecoder().decode(rawBytes));
  
  const seed = `${payload.user_id}:${payload.slug}:${payload.md5_id}`;
  const mediaBytes = Uint8Array.from(payload.media, c => c.charCodeAt(0));
  const decrypted = await aesCtrTransform(mediaBytes, seed, 'decrypt');
  const mediaJson = JSON.parse(new TextDecoder().decode(decrypted));

  const qualities: any[] = [];
  const sources = mediaJson.mp4?.sources || [];
  
  for (const src of sources) {
    if (src.file) {
      qualities.push({ resolution: src.label || "Unknown", url: src.file });
    } else if (src.path && src.size) {
      const pathBytes = new TextEncoder().encode(`/mp4/${payload.md5_id}/${src.res_id}/${src.size}?v=${payload.slug}`);
      const encPath = await aesCtrTransform(pathBytes, src.size.toString(), 'encrypt');
      const soraToken = btoa(btoa(String.fromCharCode(...encPath)));
      const domain = mediaJson.mp4.domains?.find((d: string) => src.sub.includes(d)) || "abysscdn.com";
      qualities.push({ resolution: src.label, size: src.size, url: `https://${domain}/sora/${src.size}/${soraToken}` });
    }
  }
  return { host: "abysscdn.com", source_type: "mp4", qualities };
}

// ==========================================
// 4. API ROUTES
// ==========================================

app.get('/api/health', (c) => c.json({ status: "operational", edge: true }));

app.get('/api/search', async (c) => {
  const query = c.req.query('q');
  if (!query) return c.json({ error: "Missing query" }, 400);
  
  const html = await fetchPage(`/?s=${encodeURIComponent(query)}`);
  // Regex to extract search results (Faster than Cheerio)
  const regex = /<a[^>]+href="([^"]*\/(?:anime|series|movies)\/[^"]+)"[^>]*>[\s\S]*?class="[^"]*title[^"]*"[^>]*>([^<]+)/gi;
  const results = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    results.push({ url: match[1], title: match[2].trim() });
  }
  return c.json({ query, results });
});

app.get('/api/servers', async (c) => {
  const ep = c.req.query('ep');
  if (!ep) return c.json({ error: "Missing episode" }, 400);
  
  const html = await fetchPage(`/episode/${ep}/`);
  const serverRegex = /<div[^>]*id="options-(\d+)"[^>]*>[\s\S]*?<iframe[^>]*(?:src|data-src)="([^"]+)"/gi;
  const servers = [];
  let match;
  while ((match = serverRegex.exec(html)) !== null) {
    servers.push({ server_id: parseInt(match[1]), embed_url: match[2] });
  }
  return c.json({ episode_id: ep, servers });
});

app.get('/api/stream', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ error: "Missing url" }, 400);
  
  try {
    if (url.includes('as-cdn26.top')) return c.json(await resolveAsCdn26(url));
    if (url.includes('short.icu') || url.includes('abysscdn.com') || url.includes('multi-lang-plyr')) return c.json(await resolveAbyss(url));
    return c.json({ error: "Unsupported host" }, 400);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default app;
