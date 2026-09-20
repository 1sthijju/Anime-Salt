// ==========================================================================
// Catalog card parsers — series/movie listings
// Chunk-based: split HTML into per-card chunks FIRST, then extract fields locally
// Prevents cross-card boundary pairing bugs
// ==========================================================================

const cleanTitle = (t) =>
  String(t || "")
    .replace(/<[^>]+>/g, "")
    .replace(/^Image\s+/i, "")
    .replace(/^View\s+(Serie|Movie|Series)s?\s*/i, "")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .trim();

const pickImage = (chunk) => {
  // Prefer lazy-load attributes; reject inline data: placeholders
  const m =
    chunk.match(
      /<img[^>]*?\b(?:data-lazy-src|data-src|data-original|data-cfsrc|data-bg)="([^"]+)"/i
    ) || chunk.match(/<img[^>]*?\bsrc="(?!data:)([^"]+)"/i);
  return m ? m[1] : "";
};

const pickTitle = (chunk) => {
  const m =
    chunk.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i) ||
    chunk.match(/\btitle="([^"]{2,120})"/i) ||
    chunk.match(/\balt="([^"]{2,120})"/i);
  return cleanTitle(m ? m[1] : "");
};

/**
 * Parse catalog cards from HTML.
 * Strategy: split HTML into per-card chunks using class/id patterns,
 * then extract link/image/title inside each chunk independently.
 */
export function parseCatalogItems(html) {
  const out = [];

  // Split into chunks: each chunk starts with a card wrapper element
  const chunks = html.split(
    /(?=<(?:article|div|li)\b[^>]*\b(?:class|id)="[^"]*(?:bs|bsx|item|card|post|poster|tt|mlw|thumb)[^"]*")/i
  );

  for (const chunk of chunks) {
    const link = chunk.match(
      /href="(https?:\/\/animesalt\.cx\/(series|movies)\/([^"\/?#]+)\/?)"/i
    );
    if (!link) continue;
    const [, url, kind, slug] = link;
    const title = pickTitle(chunk);
    if (!title || title.length < 2) continue;
    out.push({
      id: slug,
      title,
      image: pickImage(chunk),
      type: kind === "movies" ? "movie" : "series",
      url,
    });
  }

  // Fallback: plain link scan (pages with no card wrappers)
  if (!out.length) {
    const re =
      /<a[^>]+href="(https?:\/\/animesalt\.cx\/(series|movies)\/([^"\/?#]+)\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const title = cleanTitle(m[4]);
      if (!title || title.length < 2 || /^(View|Read)\b/i.test(title)) continue;
      out.push({
        id: m[3],
        title,
        image:
          pickImage(m[4]) ||
          pickImage(html.slice(Math.max(0, m.index - 600), m.index)),
        type: m[2] === "movies" ? "movie" : "series",
        url: m[1],
      });
    }
  }

  // Dedupe by id
  const seen = new Set();
  return out.filter((it) => {
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });
}

/**
 * Parse Most-Watched numbered lists from homepage.
 */
export function parseMostWatched(html) {
  const grab = (heading) => {
    const idx = html.toLowerCase().indexOf(heading.toLowerCase());
    if (idx === -1) return [];
    const next = html
      .toLowerCase()
      .indexOf("most-watched", idx + heading.length);
    const block = html.slice(idx, next === -1 ? idx + 80000 : next);
    const items = [];
    const re =
      /<a[^>]+href="(https?:\/\/animesalt\.cx\/(series|movies)\/([^"\/?#]+)\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m,
      rank = 0;
    while ((m = re.exec(block)) !== null) {
      rank++;
      const title = cleanTitle(m[4]);
      if (!title || title.length < 2) continue;
      items.push({
        rank,
        id: m[3],
        title,
        image: pickImage(m[4]),
        type: m[2] === "movies" ? "movie" : "series",
        url: m[1],
      });
      if (items.length >= 25) break;
    }
    return items;
  };
  return {
    series: grab("Most-Watched Series"),
    films: grab("Most-Watched Films"),
  };
}

/**
 * Parse featured/hero items — uses most-watched as primary source.
 */
export function parseFeatured(html) {
  const mw = parseMostWatched(html);
  const pool = [...mw.series.slice(0, 3), ...mw.films.slice(0, 3)];
  if (pool.length) return pool;
  return parseCatalogItems(html).slice(0, 6);
}

/**
 * Parse latest updates from homepage.
 */
export function parseLatest(html) {
  return parseCatalogItems(html).slice(0, 24);
}

/**
 * Pick a random item from catalog.
 */
export function parseRandomItem(html) {
  const items = parseCatalogItems(html);
  return items.length ? items[Math.floor(Math.random() * items.length)] : null;
}