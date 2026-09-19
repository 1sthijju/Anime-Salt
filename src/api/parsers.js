// ==========================================================================
// AnimeSalt API — Parser Module (v3.40.0)
// Extracts structured data from upstream HTML
// ==========================================================================

/**
 * Parse catalog items (series/movies) from HTML
 * Uses multiple pattern matching for robustness
 */
export function parseCatalogItems(html) {
  const out = [];
  
  // Pattern 1: Standard article with data attributes
  const pattern1 = /<article[^>]*>[\s\S]*?<a[^>]+href="(https:\/\/animesalt\.cx\/(?:series|movies)\/([^"\/]+)\/?)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>[\s\S]*?<h[23][^>]*>([^<]+)<\/h[23]>/gi;
  let m;
  while ((m = pattern1.exec(html)) !== null) {
    const [, url, slug, img, title] = m;
    out.push({ id: slug, title: title.trim(), image: img, type: url.includes("/movies/") ? "movie" : "series", url });
  }
  
  // Pattern 2: Simpler card structure
  if (out.length === 0) {
    const pattern2 = /<a[^>]+href="(https:\/\/animesalt\.cx\/(?:series|movies)\/([^"\/]+)\/?)"[^>]*class="[^"]*(?:card|item|poster)[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>[\s\S]*?(?:<h[23][^>]*>([^<]+)<\/h[23]>|alt="([^"]+)")/gi;
    while ((m = pattern2.exec(html)) !== null) {
      const [, url, slug, img, title1, title2] = m;
      const title = (title1 || title2 || "").trim();
      if (title && !title.startsWith("View")) {
        out.push({ id: slug, title, image: img, type: url.includes("/movies/") ? "movie" : "series", url });
      }
    }
  }
  
  // Pattern 3: Extract from structured data (JSON-LD or data attributes)
  if (out.length === 0) {
    const pattern3 = /data-post-id="(\d+)"[^>]*data-slug="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>[\s\S]*?<h[23][^>]*>([^<]+)<\/h[23]>/gi;
    while ((m = pattern3.exec(html)) !== null) {
      const [, , slug, img, title] = m;
      out.push({ id: slug, title: title.trim(), image: img, type: "series", url: `https://animesalt.cx/series/${slug}/` });
    }
  }
  
  // Dedupe by id
  const seen = new Set();
  return out.filter(it => { if (seen.has(it.id)) return false; seen.add(it.id); return true; });
}

/**
 * Parse featured/hero items from homepage
 */
export function parseFeatured(html) {
  // Try multiple patterns for featured/hero content
  const patterns = [
    /<div[^>]*class="[^"]*(?:hero|featured|slider|spotlight)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi,
    /<section[^>]*class="[^"]*(?:hero|featured|spotlight)[^"]*"[^>]*>([\s\S]*?)<\/section>/gi,
    /<div[^>]*id="[^"]*(?:hero|featured|slider)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ];
  
  for (const pattern of patterns) {
    const items = [];
    let m;
    while ((m = pattern.exec(html)) !== null) {
      const block = m[1];
      const urlM = block.match(/href="(https:\/\/animesalt\.cx\/(series|movies)\/([^"\/]+)\/?)"/);
      const imgM = block.match(/<img[^>]+src="([^"]+)"/);
      const tiM = block.match(/<(?:h[123]|p)[^>]*>([^<]{3,100})<\/(?:h[123]|p)>/);
      if (urlM && tiM) {
        items.push({
          id: urlM[3],
          title: tiM[1].trim(),
          image: imgM ? imgM[1] : "",
          type: urlM[2] === "series" ? "series" : "movie",
          url: urlM[1],
        });
      }
    }
    if (items.length > 0) return items;
  }
  
  // Fallback: use parseCatalogItems
  return parseCatalogItems(html).slice(0, 6);
}

/**
 * Parse latest updates from homepage
 */
export function parseLatest(html) {
  return parseCatalogItems(html).slice(0, 24);
}

/**
 * Pick a random item from catalog
 */
export function parseRandomItem(html) {
  const items = parseCatalogItems(html);
  return items.length ? items[Math.floor(Math.random() * items.length)] : null;
}

/**
 * Parse info page for a series/movie
 */
export function parseInfoPage(html, id) {
  const titleM = html.match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h1>/i) || html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const posterM = html.match(/<div[^>]*class="[^"]*poster[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i);
  const descM = html.match(/<div[^>]*class="[^"]*(?:description|wp-content|entry-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  
  const genres = [...html.matchAll(/<a[^>]+href="[^"]*\/category\/genre\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi)].map(m => m[2].trim());
  const languages = [...html.matchAll(/<a[^>]+href="[^"]*\/category\/language\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi)].map(m => m[2].trim());
  
  const seasonsRaw = [...html.matchAll(/<option[^>]+value="(\d+)"[^>]*>Season\s*(\d+)[\s\S]*?(\d+)\s*[-–]\s*(\d+)\s*\((\d+)\)/gi)];
  const seasons = seasonsRaw.map(m => ({ num: +m[2], title: `Season ${m[2]} • ${m[3]}-${m[4]} (${m[5]})`, value: m[1] }));
  
  return {
    id,
    title: (titleM ? titleM[1] : id).trim(),
    poster: posterM ? posterM[1] : "",
    backdrop: "",
    description: descM ? descM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "",
    type: html.includes("/movies/") ? "movie" : "series",
    totalEpisodes: seasons.reduce((sum, s) => sum + (parseInt(s.title.match(/\((\d+)\)/)?.[1] || 0, 10)), 0),
    year: "",
    status: "",
    seasons,
    genres,
    languages,
    runtime: "",
    quickPlay: {
      first: seasons[0] ? { season: seasons[0].num, episode: 1, slug: `${id}-${seasons[0].num}x1` } : null,
      latestDub: seasons.length ? { season: seasons[seasons.length - 1].num, episode: 1, slug: `${id}-${seasons[seasons.length - 1].num}x1` } : null,
      latestSub: null,
    },
  };
}

/**
 * Parse streaming servers from episode page
 */
export function parseServers(html, epSlug) {
  const servers = [];
  const re = /<li[^>]*data-id="(\d+)"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [_, idxStr, embedUrl, name] = m;
    servers.push({
      index: parseInt(idxStr, 10),
      serverName: name.trim(),
      embedUrl,
      isMultiLang: /multi-lang/i.test(name),
      languages: [],
    });
  }
  return servers;
}

/**
 * Parse taxonomy (genres, languages, networks, franchises)
 */
export function parseTaxonomy(html) {
  const parse = (pattern) => [...html.matchAll(pattern)].map(m => ({ slug: m[1], name: m[2].trim() }));
  return {
    genres: parse(/<a[^>]+href="[^"]*\/category\/genre\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi),
    languages: parse(/<a[^>]+href="[^"]*\/category\/language\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi),
    types: [],
    statuses: [],
    networks: parse(/<a[^>]+href="[^"]*\/category\/network\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi),
    franchises: parse(/<a[^>]+href="[^"]*\/category\/franchise\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi),
    topLevel: [],
  };
}

/**
 * Parse taxonomy list (for /api/genres endpoint)
 */
export function parseTaxonomyList(html, kind) {
  const pattern = new RegExp(`<a[^>]+href="[^"]*\\/category\\/${kind}\\/([^"\\/]+)[^"]*"[^>]*>([^<]+)<\\/a>`, "gi");
  return [...html.matchAll(pattern)].map(m => ({ slug: m[1], name: m[2].trim() }));
}

/**
 * Parse most-watched lists from homepage
 */
export function parseMostWatched(html) {
  const series = [];
  const films = [];
  
  // Pattern for numbered lists (1. Naruto, 2. Jujutsu Kaisen, etc.)
  const listPattern = /<li[^>]*>\s*(\d+)\s*<[^>]*>([^<]+)<\/[^>]+>\s*<\/li>/gi;
  let m;
  
  let inSeries = false;
  let inFilms = false;
  
  const lines = html.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.includes("Most-Watched Series")) {
      inSeries = true;
      inFilms = false;
    } else if (line.includes("Most-Watched Films")) {
      inFilms = true;
      inSeries = false;
    }
    
    if (inSeries || inFilms) {
      const match = line.match(/^\s*(\d+)\s*<[^>]*>([^<]+)<\/[^>]+>/);
      if (match) {
        const [, rank, title] = match;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const item = {
          rank: parseInt(rank, 10),
          id: slug,
          title: title.trim(),
          image: "",
          type: inSeries ? "series" : "movie",
          url: `https://animesalt.cx/${inSeries ? 'series' : 'movies'}/${slug}/`,
        };
        if (inSeries) series.push(item);
        else films.push(item);
      }
    }
  }
  
  return { series, films };
}