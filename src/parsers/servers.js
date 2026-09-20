// ==========================================================================
// Episode server parser — streaming server lists
// Extracts server embeds from episode pages
// ==========================================================================

/**
 * Parse streaming servers from an episode page.
 */
export function parseServers(html, epSlug) {
  const servers = [];

  // Pattern 1: list items with data-id and links
  const re =
    /<li[^>]*data-id="(\d+)"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    servers.push({
      index: parseInt(m[1], 10),
      serverName: m[3].trim(),
      embedUrl: m[2],
      isMultiLang: /multi-lang/i.test(m[3]) || /multi-lang/i.test(m[2]),
      languages: [],
    });
  }

  // Pattern 2: fallback to iframes if no list items found
  if (!servers.length) {
    const re2 = /<iframe[^>]*\b(?:src|data-src)="([^"]+)"[^>]*>/gi;
    let i = 0;
    while ((m = re2.exec(html)) !== null) {
      servers.push({
        index: i++,
        serverName: `Server ${i}`,
        embedUrl: m[1],
        isMultiLang: /multi-lang/i.test(m[1]),
        languages: [],
      });
    }
  }

  return servers;
}

/**
 * Decode multi-lang server payload (base64 JSON).
 */
export function decodeMultiLang(embedUrl) {
  const m = embedUrl.match(/data=([A-Za-z0-9+/=]+)/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(atob(m[1]));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}