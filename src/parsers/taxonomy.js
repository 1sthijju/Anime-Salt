// ==========================================================================
// Taxonomy parser — genres, languages, networks, franchises
// ==========================================================================

/**
 * Parse taxonomy categories from HTML.
 * Note: homepage may not contain all categories — /api/discover should
 * fetch from a dedicated category index if available.
 */
export function parseTaxonomy(html) {
  const parse = (kind) => {
    const re = new RegExp(
      `<a[^>]+href="[^"]*\\/category\\/${kind}\\/([^"\\/]+)[^"]*"[^>]*>([^<]+)<\\/a>`,
      "gi"
    );
    const seen = new Set();
    const out = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      const name = m[2].trim();
      if (!name || name.length > 40 || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ slug: m[1], name });
    }
    return out;
  };

  return {
    genres: parse("genre"),
    languages: parse("language"),
    networks: parse("network"),
    franchises: parse("franchise"),
    types: parse("type"),
    statuses: parse("status"),
    topLevel: [],
  };
}