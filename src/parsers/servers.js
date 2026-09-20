// ==========================================================================
// Episode server parser v3 — button pattern + multi-lang detection
// ==========================================================================

/**
 * Parse streaming servers from an episode page.
 * Real HTML: <div class="server-btn [active]" onclick="changeServer(N)">
 */
export function parseServers(html, epSlug) {
  const servers = [];

  // Primary pattern: server buttons with changeServer(N) onclick
  const re =
    /<div\s+class="server-btn([^"]*)"[^>]*onclick="changeServer\((\d+)\)"[^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [_, classes, idx, content] = m;
    const isMulti =
      /multi/i.test(content) || /multi/i.test(classes) || /data=/.test(html);
    const nameM = content.match(/<div\s+class="server-name">([^<]+)<\/div>/i);
    servers.push({
      index: parseInt(idx, 10),
      serverName: nameM ? nameM[1].trim() : `Server ${idx}`,
      embedUrl: "", // filled by stream handler via AJAX or page context
      isActive: /active/i.test(classes),
      isMultiLang: isMulti,
    });
  }

  // Fallback: list items with data-id
  if (!servers.length) {
    const re2 =
      /<li[^>]*data-id="(\d+)"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi;
    let m2;
    while ((m2 = re2.exec(html)) !== null) {
      servers.push({
        index: parseInt(m2[1], 10),
        serverName: m2[3].trim(),
        embedUrl: m2[2],
        isActive: false,
        isMultiLang: /multi/i.test(m2[3]) || /data=/.test(m2[2]),
      });
    }
  }

  return servers;
}

/**
 * Decode multi-lang base64 payload from embedUrl.
 */
export function decodeMultiLang(embedUrl) {
  const m = embedUrl.match(/data=([A-Za-z0-9+/=]+)/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(atob(m[1]));
    return Array.isArray(parsed)
      ? parsed.map((l) => ({
          language: l.language,
          link: String(l.link || "").replace(/\\\//g, "/"),
        }))
      : [];
  } catch {
    return [];
  }
}