// ==========================================================================
// Episode server parser v2 — extracts real embed URLs
// ==========================================================================

export function parseServers(html, epSlug) {
  const servers = [];

  // Strategy 1: Extract from JavaScript variable (most common)
  // Pattern: var servers = [{url: "...", ...}, ...]
  const jsVarMatch = html.match(/var\s+servers\s*=\s*(\[[\s\S]*?\]);/i);
  if (jsVarMatch) {
    try {
      const serversArray = JSON.parse(jsVarMatch[1]);
      serversArray.forEach((srv, idx) => {
        servers.push({
          index: idx,
          serverName: srv.name || srv.label || `Server ${idx + 1}`,
          embedUrl: srv.url || srv.link || srv.src || "",
          isActive: idx === 0, // first server usually active
          isMultiLang: srv.multi || srv.isMulti || /multi/i.test(srv.name || ""),
        });
      });
    } catch {}
  }

  // Strategy 2: Extract from server buttons + iframes
  if (!servers.length) {
    // Find all server buttons
    const buttonRe = /<div[^>]*class="server-btn([^"]*)"[^>]*onclick="changeServer\((\d+)\)"[^>]*>([\s\S]*?)<\/div>/gi;
    const buttons = [];
    let bm;
    while ((bm = buttonRe.exec(html)) !== null) {
      const [, classes, idx, content] = bm;
      const nameM = content.match(/<div\s+class="server-name">([^<]+)<\/div>/i);
      buttons.push({
        index: parseInt(idx, 10),
        serverName: nameM ? nameM[1].trim() : `Server ${idx}`,
        isActive: /active/i.test(classes),
        isMultiLang: /multi/i.test(content) || /multi/i.test(classes),
      });
    }

    // Find all iframe srcs (these are the actual embed URLs)
    const iframeRe = /<iframe[^>]*src="([^"]+)"[^>]*>/gi;
    const iframes = [];
    let im;
    while ((im = iframeRe.exec(html)) !== null) {
      iframes.push(im[1]);
    }

    // Match buttons to iframes by index
    buttons.forEach((btn, idx) => {
      servers.push({
        index: btn.index,
        serverName: btn.serverName,
        embedUrl: iframes[btn.index] || iframes[idx] || "",
        isActive: btn.isActive,
        isMultiLang: btn.isMultiLang,
      });
    });
  }

  // Strategy 3: Extract from data attributes
  if (!servers.length) {
    const dataRe = /<a[^>]*data-server[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    let dm;
    let idx = 0;
    while ((dm = dataRe.exec(html)) !== null) {
      servers.push({
        index: idx++,
        serverName: dm[2].trim(),
        embedUrl: dm[1],
        isActive: idx === 1,
        isMultiLang: /multi/i.test(dm[2]),
      });
    }
  }

  // Strategy 4: Fallback — extract any as-cdn or animesalt embed URLs
  if (!servers.length) {
    const embedRe = /(?:as-cdn|animesalt)[^"'\s]*\.(?:top|cx|com)\/[^"'\s<>]+/gi;
    let em;
    let idx = 0;
    while ((em = embedRe.exec(html)) !== null) {
      if (em[0].includes("episode") || em[0].includes("series")) continue;
      servers.push({
        index: idx++,
        serverName: `Server ${idx}`,
        embedUrl: em[0].startsWith("http") ? em[0] : "https://" + em[0],
        isActive: idx === 1,
        isMultiLang: false,
      });
      if (servers.length >= 5) break;
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