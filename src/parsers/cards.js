// ==========================================================================
// Catalog card parsers v3 — heading filtering + chunk-based
// ==========================================================================

// Known section headings to skip when extracting titles
const HEADING_PATTERNS = [
  /^Most[- ]Watched/i,
  /^Latest/i,
  /^Popular/i,
  /^Fresh/i,
  /^Ongoing/i,
  /^Completed/i,
  /^Genres/i,
  /^Languages/i,
  /^Networks/i,
  /^Franchises/i,
];

const isHeading = (title) =>
  HEADING_PATTERNS.some((pat) => pat.test(title));

const clean = (t) =>
  String(t || "")
    .replace(/<[^>]+>/g, "")
    .replace(/^Image\s+/i, "")
    .replace(/^View\s+(Serie|Movie|Series)s?\s*/i, "")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&nbsp;/g, " ")
    .trim();

const fixUrl = (u) => (u && u.startsWith("//") ? "https:" + u : u || "");

const pickImage = (chunk) => {
  const m =
    chunk.match(
      /<img[^>]*?\b(?:data-lazy-src|data-src|data-original|data-cfsrc|data-bg)="([^"]+)"/i
    ) || chunk.match(/<img[^>]*?\bsrc="(?!data:)([^"]+)"/i);
  return m ? fixUrl(m[1]) : "";
};

const pickTitle = (chunk) => {
  // Try h-tag title first, skip headings
  const h = chunk.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
  if (h) {
    const t = clean(h[1]);
    if (t && !isHeading(t)) return t;
  }
  // Fallback to alt/title attributes
  const alt =
    chunk.match(/\btitle="([^"]{2,120})"/i) ||
    chunk.match(/\balt="([^"]{2,120})"/i);
  if (alt) {
    const t = clean(alt[1]).replace(/^Image\s+/i, "");
    if (t && !isHeading(t)) return t;
  }
  return "";
};

/**
 * Parse catalog cards using chunk-based splitting.
 * Skips section headings. Prefers data-src over src (lazy-load).
 */
export function parseCatalogItems(html) {
  const out = [];
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

  // Dedupe by id
  const seen = new Set();
  return out.filter((it) => {
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });
}

/**
 * Parse Most-Watched from chart-item grid structure.
 * Real HTML: <div class="chart-item"> with chart-number, chart-poster, chart-title
 */
export function parseMostWatched(html) {
  const grab = (heading) => {
    const idx = html.toLowerCase().indexOf(heading.toLowerCase());
    if (idx === -1) return [];
    const next = html
      .toLowerCase()
      .indexOf("most-watched", idx + heading.length);
    const altNext = html.toLowerCase().indexOf("latest", idx + heading.length);
    const endIdx =
      next === -1
        ? altNext === -1
          ? idx + 80000
          : altNext
        : next;
    const block = html.slice(idx, endIdx);

    const items = [];
    const itemChunks = block.split(/(?=<div\s+class="chart-item")/i);
    for (const chunk of itemChunks) {
      const numM = chunk.match(/<div\s+class="chart-number">(\d+)<\/div>/i);
      if (!numM) continue;
      const rank = parseInt(numM[1], 10);

      const linkM = chunk.match(
        /<a[^>]+href="(https?:\/\/animesalt\.cx\/(series|movies)\/([^"\/?#]+)\/?)"[^>]*class="chart-poster"/i
      );
      if (!linkM) continue;
      const [, url, kind, slug] = linkM;

      const titleM = chunk.match(/<div\s+class="chart-title">([^<]+)<\/div>/i);
      const title = titleM ? clean(titleM[1]) : "";

      const imgM = chunk.match(/<img[^>]*?\bdata-src="([^"]+)"/i);
      const image = imgM ? fixUrl(imgM[1]) : "";

      if (title) {
        items.push({
          rank,
          id: slug,
          title,
          image,
          type: kind === "movies" ? "movie" : "series",
          url,
        });
      }
    }
    return items;
  };

  return {
    series: grab("Most-Watched Series"),
    films: grab("Most-Watched Films"),
  };
}

/** Featured items — uses most-watched as primary source */
export function parseFeatured(html) {
  const mw = parseMostWatched(html);
  const pool = [...mw.series.slice(0, 3), ...mw.films.slice(0, 3)];
  return pool.length ? pool : parseCatalogItems(html).slice(0, 6);
}

export function parseLatest(html) {
  return parseCatalogItems(html).slice(0, 24);
}

export function parseRandomItem(html) {
  const items = parseCatalogItems(html);
  return items.length ? items[Math.floor(Math.random() * items.length)] : null;
}