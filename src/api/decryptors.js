// ---------------------------------------------------------------------------
// Stream decryptors for AnimeSalt Edge API
// - resolveAsCdn26: as-cdn26.top HLS decryption
// - resolveAbyss: Abyss family (short.icu, short.ink, abysscdn, hydraxcdn, etc.)
// - normalizeAbyssUrl: protocol-relative → https
// ---------------------------------------------------------------------------

export function normalizeAbyssUrl(url) {
  if (!url) return "";
  if (url.startsWith("//")) return "https:" + url;
  return url;
}

export async function resolveAsCdn26(embedUrl) {
  try {
    const res = await fetch(embedUrl, {
      headers: {
        "Referer": "https://as-cdn26.top/",
        "Origin": "https://as-cdn26.top",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!res.ok) {
      return { embedUrl, host: "as-cdn26.top", isIframe: true };
    }

    const html = await res.text();

    // Try multiple patterns to find HLS m3u8 URL in inline JS config
    const patterns = [
      // Direct URL in any quoted context
      /(https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*)/i,
      // source/file key (JWPlayer style)
      /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
      /source:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
      /file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
      // JSON config with escaped slashes
      /["']?(?:url|src|hls|m3u8|stream|video)["']?\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        // Unescape slashes and return the URL
        const m3u8Url = match[1].replace(/\\\//g, "/");
        return {
          direct_hls: m3u8Url,
          qualities: [],
          subtitles: [],
          host: "as-cdn26.top"
        };
      }
    }

    // Try to find an API endpoint pattern (as-cdn26 often uses /api/stream or similar)
    const apiMatch = html.match(/["'](\/api\/[^"']+)["']/i);
    if (apiMatch) {
      try {
        const apiUrl = new URL(apiMatch[1], "https://as-cdn26.top").toString();
        const apiRes = await fetch(apiUrl, {
          headers: {
            "Referer": "https://as-cdn26.top/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        });
        if (apiRes.ok) {
          const json = await apiRes.json();
          if (json && (json.url || json.source || json.file)) {
            const streamUrl = json.url || json.source || json.file;
            if (streamUrl && streamUrl.includes(".m3u8")) {
              return {
                direct_hls: streamUrl,
                qualities: [],
                subtitles: json.subtitles || [],
                host: "as-cdn26.top"
              };
            }
          }
        }
      } catch (e) { /* fallthrough */ }
    }

    // Could not decrypt — return iframe fallback
    return { embedUrl, host: "as-cdn26.top", isIframe: true };
  } catch (e) {
    return { embedUrl, host: "as-cdn26.top", isIframe: true, error: e.message };
  }
}

export async function resolveAbyss(embedUrl) {
  try {
    const normalizedUrl = normalizeAbyssUrl(embedUrl);
    const res = await fetch(normalizedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!res.ok) {
      return { embedUrl: normalizedUrl, host: "abyss", isIframe: true };
    }

    const html = await res.text();

    // Look for HLS m3u8 URL
    const m3u8Match = html.match(/(https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*)/i);
    if (m3u8Match) {
      return { direct_hls: m3u8Match[1], qualities: [], subtitles: [], host: "abyss" };
    }

    // Look for direct MP4 URL
    const mp4Match = html.match(/(https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*)/i);
    if (mp4Match) {
      return { direct_url: mp4Match[1], host: "abyss" };
    }

    // Look for packed JS (eval/p,a,c,k,e,d pattern)
    if (html.includes("eval(function(p,a,c,k,e,d)")) {
      // Try to find URL after unpacking (best effort)
      const urlInPacked = html.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/);
      if (urlInPacked) {
        const url = urlInPacked[1];
        if (url.includes(".m3u8")) return { direct_hls: url, qualities: [], subtitles: [], host: "abyss" };
        if (url.includes(".mp4")) return { direct_url: url, host: "abyss" };
      }
    }

    // Look for nested iframe (some Abyss variants wrap another iframe)
    const nestedIframe = html.match(/<iframe[^>]*(?:src|data-src)="([^"]+)"/i);
    if (nestedIframe && !nestedIframe[1].includes("abyss")) {
      return { embedUrl: nestedIframe[1], host: "abyss", isIframe: true, nested: true };
    }

    return { embedUrl: normalizedUrl, host: "abyss", isIframe: true };
  } catch (e) {
    return { embedUrl, host: "abyss", isIframe: true, error: e.message };
  }
}