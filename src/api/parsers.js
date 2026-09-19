// ==========================================================================
// AnimeSalt API — Parser Module (v3.41.0)
// Chunk-based parsing: no cross-card boundary pairing, lazy-src aware
// ==========================================================================

const cleanTitle = (t) => String(t || "")
  .replace(/<[^>]+>/g, "")
  .replace(/^Image\s+/i, "")
  .replace(/^View\s+(Serie|Movie|Series)s?\s*/i, "")
  .replace(/&amp;/g, "&").replace(/&#8217;/g, "'").replace(/&#8211;/g, "-")
  .trim();

const pickImage = (chunk) => {
  // Prefer lazy-load attributes; reject inline data: placeholders
  const m = chunk.match(/<img[^>]*?\b(?:data-lazy-src|data-src|data-original|data-cfsrc|data-bg)="([^"]+)"/i)
         || chunk.match(/<img[^>]*?\bsrc="(?!data:)([^"]+)"/i);
  return m ? m[1] : "";
};

const pickTitle = (chunk) => {
  const m = chunk.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)
         || chunk.match(/\btitle="([^"]{2,120})"/i)
         || chunk.match(/\balt="([^"]{2,120})"/i);
  return cleanTitle(m ? m[1] : "");
};

/**
 * Parse catalog cards. Splits HTML into per-card chunks FIRST,
 * then extracts link/image/title inside each chunk independently.
 */
export function parseCatalogItems(html) {
  const out = [];
  const chunks = html.split(/(?=<(?:article|div|li)\b[^>]*\b(?:class|id)="[^"]*(?:bs|bsx|item|card|post|poster|tt|mlw|thumb)[^"]*")/i);

  for (const chunk of chunks) {
    const link = chunk.match(/href="(https?:\/\/animesalt\.cx\/(series|movies)\/([^"\/?#]+)\/?)"/i);
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
    const re = /<a[^>]+href="(https?:\/\/animesalt\.cx\/(series|movies)\/([^"\/?#]+)\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const title = cleanTitle(m[4]);
      if (!title || title.length < 2 || /^(View|Read)\b/i.test(title)) continue;
      out.push({ id: m[3], title, image: pickImage(m[4]) || pickImage(html.slice(Math.max(0, m.index - 600), m.index)), type: m[2] === "movies" ? "movie" : "series", url: m[1] });
    }
  }

  const seen = new Set();
  return out.filter(it => { if (seen.has(it.id)) return false; seen.add(it.id); return true; });
}

/**
 * Most-Watched numbered lists from homepage.
 */
export function parseMostWatched(html) {
  const grab = (heading) => {
    const idx = html.toLowerCase().indexOf(heading.toLowerCase());
    if (idx === -1) return [];
    const next = html.toLowerCase().indexOf("most-watched", idx + heading.length);
    const block = html.slice(idx, next === -1 ? idx + 80000 : next);
    const items = [];
    const re = /<a[^>]+href="(https?:\/\/animesalt\.cx\/(series|movies)\/([^"\/?#]+)\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m, rank = 0;
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
  return { series: grab("Most-Watched Series"), films: grab("Most-Watched Films") };
}

export function parseFeatured(html) {
  const mw = parseMostWatched(html);
  const pool = [...mw.series.slice(0, 3), ...mw.films.slice(0, 3)];
  if (pool.length) return pool;
  return parseCatalogItems(html).slice(0, 6);
}

export function parseLatest(html) {
  return parseCatalogItems(html).slice(0, 24);
}

export function parseRandomItem(html) {
  const items = parseCatalogItems(html);
  return items.length ? items[Math.floor(Math.random() * items.length)] : null;
}

export function parseInfoPage(html, id) {
  const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const posterM = html.match(/<div[^>]*class="[^"]*poster[^"]*"[^>]*>[\s\S]*?<img[^>]*?\b(?:data-src|src)="([^"]+)"/i)
               || html.match(/<img[^>]*?\b(?:data-src|src)="(?!data:)([^"]+)"/i);
  const descM = html.match(/<div[^>]*class="[^"]*(?:description|wp-content|entry-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const genres = [...html.matchAll(/<a[^>]+href="[^"]*\/category\/genre\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi)].map(m => m[2].trim());
  const languages = [...html.matchAll(/<a[^>]+href="[^"]*\/category\/language\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi)].map(m => m[2].trim());
  const seasonsRaw = [...html.matchAll(/<option[^>]+value="(\d+)"[^>]*>([\s\S]*?)<\/option>/gi)]
    .map(m => ({ value: m[1], label: cleanTitle(m[2]) }))
    .filter(s => /Season\s*\d+/i.test(s.label));
  const seasons = seasonsRaw.map(s => {
    const num = parseInt(s.label.match(/Season\s*(\d+)/i)[1], 10);
    return { num, title: s.label, value: s.value };
  });
  return {
    id,
    title: cleanTitle(titleM ? titleM[1] : id),
    poster: posterM ? posterM[1] : "",
    backdrop: "",
    description: descM ? cleanTitle(descM[1]) : "",
    type: html.includes("/movies/") ? "movie" : "series",
    totalEpisodes: seasons.reduce((sum, s) => sum + (parseInt((s.title.match(/\((\d+)\)/) || [])[1] || 0, 10)), 0),
    year: (html.match(/\b(19[5-9]\d|20[0-2]\d)\b/) || [])[1] || "",
    status: (html.match(/Status[:\s]*([A-Za-z]+)/i) || [])[1] || "",
    seasons, genres, languages,
    runtime: (html.match(/(\d+)\s*min/i) || [])[1] || "",
    quickPlay: {
      first: seasons[0] ? { season: seasons[0].num, episode: 1, slug: `${id}-${seasons[0].num}x1` } : null,
      latestDub: seasons.length ? { season: seasons[seasons.length - 1].num, episode: 1, slug: `${id}-${seasons[seasons.length - 1].num}x1` } : null,
      latestSub: null,
    },
  };
}

export function parseServers(html, epSlug) {
  const servers = [];
  const re = /<li[^>]*data-id="(\d+)"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi;
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
  if (!servers.length) {
    const re2 = /<iframe[^>]*\b(?:src|data-src)="([^"]+)"[^>]*>/gi;
    let i = 0;
    while ((m = re2.exec(html)) !== null) {
      servers.push({ index: i++, serverName: `Server ${i}`, embedUrl: m[1], isMultiLang: /multi-lang/i.test(m[1]), languages: [] });
    }
  }
  return servers;
}

export function parseTaxonomy(html) {
  const parse = (kind) => {
    const re = new RegExp(`<a[^>]+href="[^"]*\\/category\\/${kind}\\/([^"\\/]+)[^"]*"[^>]*>([^<]+)<\\/a>`, "gi");
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