export async function decryptAsCdn26(embedUrl) {
  const res = await fetch(embedUrl, {
    headers: {
      "Referer": "https://as-cdn26.top/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });
  const html = await res.text();
  
  // Matches direct HLS m3u8 URL in inline JS config
  const m3u8Match = html.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
  if (m3u8Match) {
    return {
      direct_hls: m3u8Match[1],
      qualities: [],
      subtitles: [],
      host: "as-cdn26.top"
    };
  }
  
  return { embedUrl, host: "as-cdn26.top", isIframe: true };
}

export async function decryptAbyss(embedUrl) {
  const res = await fetch(embedUrl);
  const html = await res.text();
  
  // Matches m3u8 or mp4 URLs in packed Abyss JS
  const m3u8Match = html.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
  const mp4Match = html.match(/(https?:\/\/[^"']+\.mp4[^"']*)/i);
  
  if (m3u8Match) return { direct_hls: m3u8Match[1], host: "abyss" };
  if (mp4Match) return { direct_url: mp4Match[1], host: "abyss" };
  
  return { embedUrl, host: "abyss", isIframe: true };
}