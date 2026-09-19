// ---------------------------------------------------------------------------
// AnimeSalt Edge API — HTML parsers
// Pure functions: (html, ...) -> data. No side effects, no I/O.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Generic card grids (home, category, search pages)
// Matches <article class="...post..."> blocks — the WordPress wrapper
// animesalt uses for all catalog cards.
// ---------------------------------------------------------------------------
export function extractAnimeList(html) {
  const results = [];
  const articleRegex = /<article[^>]*class="[^"]*post[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = articleRegex.exec(html)) !== null) {
    const h = match[1];
    const urlMatch = h.match(/href="([^"]+\/(?:series|movies|anime)\/[^"]+)"/i);
    const url = urlMatch ? urlMatch[1] : "";
    const slugMatch = url.match(/\/(?:series|movies|anime)\/([^/]+)\/?$/);
    const id = slugMatch ? slugMatch[1] : "";
    if (!id) continue;

    const titleMatch =
      h.match(/class="[^"]*(?:entry-title|title)[^"]*"[^>]*>([^<]+)/i) ||
      h.match(/alt="([^"]+)"/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    const imgMatch =
      h.match(/\bdata-src="([^"]+)"/i) ||
      h.match(/\bdata-lazy-src="([^"]+)"/i) ||
      h.match(/\bdata-original="([^"]+)"/i) ||
      h.match(/\bsrc="([^"]+)"/i);
    let image = imgMatch ? imgMatch[1] : "";
    if (image.startsWith("data:")) image = "";
    if (image.startsWith("//")) image = "https:" + image;

    results.push({
      id,
      title,
      image,
      type: url.includes("/movies/") ? "movie" : "series",
      url,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Ranked chart blocks ("Most-Watched Series" / "Most-Watched Films")
// ---------------------------------------------------------------------------
export function extractPopularItems(html, targetType) {
  const results = [];
  const chartRegex = /<div[^>]*class="[^"]*chart-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let match;
  while ((match = chartRegex.exec(html)) !== null) {
    const itemHtml = match[1];
    const rankMatch = itemHtml.match(/class="[^"]*chart-number[^"]*"[^>]*>(\d+)/i);
    const rank = rankMatch ? parseInt(rankMatch[1], 10) : null;

    const linkMatch = itemHtml.match(/href="([^"]+\/(?:series|movies|anime)\/[^"]+)"/i);
    const url = linkMatch ? linkMatch[1] : "";
    const slugMatch = url.match(/\/(?:series|movies|anime)\/([^/]+)\/?$/);
    const id = slugMatch ? slugMatch[1] : "";
    if (!id) continue;

    const type = url.includes("/movies/") ? "movie" : "series";
    if (targetType && type !== targetType) continue;

    const titleMatch =
      itemHtml.match(/class="[^"]*chart-title[^"]*"[^>]*>([^<]+)/i) ||
      itemHtml.match(/alt="([^"]+)"/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    const imgMatch =
      itemHtml.match(/\bdata-src="([^"]+)"/i) ||
      itemHtml.match(/\bdata-lazy-src="([^"]+)"/i) ||
      itemHtml.match(/\bsrc="([^"]+)"/i);
    let image = imgMatch ? imgMatch[1] : "";
    if (image.startsWith("data:")) image = "";
    if (image.startsWith("//")) image = "https:" + image;

    if (!results.find(r => r.id === id)) {
      results.push({ rank, id, title, image, type, url });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Episode grid (WordPress AJAX fragment returned by admin-ajax)
// ---------------------------------------------------------------------------
export function parseEpisodesFromHtml(html, seasonNum) {
  const eps = [];
  const DUB_DIVIDER = /aren['’]t dubbed in regional languages/i;
  let regionalDub = true;
  let lastIdx = 0;

  const epRegex = /<a[^>]+href="([^"]+\/episode\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  const grabUrl = (fragment) => {
    const tags = [...fragment.matchAll(/<img[^>]*>/gi)];
    for (let i = tags.length - 1; i >= 0; i--) {
      const tag = tags[i][0];
      const lazy = tag.match(
        /\b(?:data-lazy-src|data-original|data-src|data-cfsrc|data-bg|data-lazy|data-echo)="([^"]+)"/i
      );
      const srcset =
        tag.match(/\bdata-srcset="([^"]+)"/i) || tag.match(/\bsrcset="([^"]+)"/i);
      const plain = tag.match(/\bsrc="([^"]+)"/i);
      let u = lazy
        ? lazy[1]
        : srcset
        ? srcset[1].split(/[ ,]/)[0]
        : plain && !plain[1].startsWith("data:")
        ? plain[1]
        : "";
      if (u && !u.startsWith("data:")) return u;
    }
    const bg = fragment.match(
      /background(?:-image)?:\s*(?:[^;'"()]*?,\s*)?url\(\s*['"]?([^'")]+)['"]?\s*\)/i
    );
    if (bg && !bg[1].startsWith("data:")) return bg[1];
    return "";
  };

  while ((match = epRegex.exec(html)) !== null) {
    const between = html.slice(lastIdx, match.index);
    if (DUB_DIVIDER.test(between)) regionalDub = false;
    lastIdx = match.index + match[0].length;

    const url = match[1];
    const slugMatch = url.match(/\/episode\/([^/]+)\/?$/);
    const epSlug = slugMatch ? slugMatch[1] : "";
    if (!epSlug) continue;

    const sxe = epSlug.match(/(\d+)x(\d+)$/);
    const sNum = sxe ? parseInt(sxe[1], 10) : seasonNum;
    const epNum = sxe ? parseInt(sxe[2], 10) : 0;
    if (epNum === 0) continue;

    const linkHtml = match[2];
    let title = "";
    
    const titlePatterns = [
      /class="[^"]*(?:entry-title|title|ep-title)[^"]*"[^>]*>([^<]+)/i,
      /<span[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/span>/i,
      /<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/div>/i,
      />([^<]+)<\/a>/i,
    ];
    
    for (const pattern of titlePatterns) {
      const titleMatch = linkHtml.match(pattern);
      if (titleMatch) {
        title = titleMatch[1].trim();
        title = title.replace(/^\d+[\.\)]\s*/, "");
        title = title.replace(/\s*View\s*$/i, "");
        title = title.replace(/Episode\s+\d+/i, "");
        if (title.length > 2) break;
      }
    }
    
    if (!title || title.length < 3) {
      title = `Episode ${epNum}`;
    }

    let image = grabUrl(linkHtml);
    if (!image) {
      const windowStart = Math.max(0, match.index - 800);
      image = grabUrl(html.slice(windowStart, match.index));
    }
    if (image.startsWith("//")) image = "https:" + image;

    if (!eps.find(e => e.slug === epSlug)) {
      eps.push({
        num: epNum,
        season: sNum,
        title,
        slug: epSlug,
        url,
        image: image || null,
        regionalDub,
      });
    }
  }
  return eps;
}

// ---------------------------------------------------------------------------
// Server iframe embed URL for a given server index
// ---------------------------------------------------------------------------
export function extractEmbedForIndex(html, index) {
  const containerRegex = new RegExp(
    `<div[^>]*id="options-${index}"[^>]*>([\\s\\S]*?)(?=<div[^>]*id="options-\\d+|<div[^>]*class="[^"]*(?:server-section|download|related)[^"]*"|</section>|<footer[^>]*>|$)`,
    "i"
  );
  const containerMatch = html.match(containerRegex);
  if (containerMatch) {
    const iframeMatch = containerMatch[1].match(/<iframe[^>]*(?:src|data-src)="([^"]+)"/i);
    if (iframeMatch && iframeMatch[1]) return iframeMatch[1];
  }
  const iframeRegex = /<iframe[^>]*(?:src|data-src)="([^"]+)"/gi;
  let m, i = 0;
  while ((m = iframeRegex.exec(html)) !== null) {
    if (i === index) return m[1];
    i++;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Taxonomy link lists (genre / language / country / quality / season / ...)
// STRICT: only matches real <a> tags. Simplified filtering to avoid false
// positives from <head> script/style blocks while allowing all valid genres.
// ---------------------------------------------------------------------------
export function extractTaxonomy(html, tax) {
  const results = [];
  const regex = new RegExp(
    `<a[^>]+href="([^"]*\\/${tax}\\/([^\\/"]+)\\/?)["'][^>]*>([\\s\\S]*?)</a>`,
    "gi"
  );
  
  let m;
  while ((m = regex.exec(html)) !== null) {
    const fullUrl = m[1];
    const slug = m[2];
    let name = m[3].replace(/<[^>]+>/g, "").trim();
    
    if (!name || name.length > 50) continue;
    
    const nameLower = name.toLowerCase();
    if (nameLower === 'all' || nameLower === 'view all' || nameLower === 'see all') continue;
    
    if (name.length < 2) {
      name = slug.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    }

    if (slug && name && !results.find(r => r.slug === slug)) {
      results.push({ slug, name, url: fullUrl });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Extract all categories from sitemap or homepage
// Handles both /category/taxonomy/term/ and /category/term/ patterns
// Parses XML sitemap structure to extract <loc> URLs
// ---------------------------------------------------------------------------
export function extractAllCategories(html) {
  const results = {
    genres: [],
    languages: [],
    types: [],
    statuses: [],
    networks: [],
    franchises: [],
    topLevel: []
  };

  // Check if this is XML sitemap (has <urlset> or <loc> tags)
  const isXml = html.includes('<urlset') || html.includes('<loc>');
  
  if (isXml) {
    // Parse XML sitemap - extract all <loc> tags
    const locRegex = /<loc>(.*?)<\/loc>/gi;
    let m;
    
    while ((m = locRegex.exec(html)) !== null) {
      const url = m[1].trim();
      
      // Must be a category URL
      if (!url.includes('/category/')) continue;
      
      // Extract path after /category/
      const catMatch = url.match(/\/category\/(.+)/);
      if (!catMatch) continue;
      
      const path = catMatch[1];
      const parts = path.split('/').filter(p => p);
      
      if (parts.length === 2) {
        // /category/taxonomy/term/ pattern
        const taxonomy = parts[0];
        const slug = parts[1];
        const name = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        
        if (taxonomy === 'genre') {
          results.genres.push({ slug, name, url });
        } else if (taxonomy === 'language') {
          results.languages.push({ slug, name, url });
        } else if (taxonomy === 'type') {
          results.types.push({ slug, name, url });
        } else if (taxonomy === 'status') {
          results.statuses.push({ slug, name, url });
        } else if (taxonomy === 'network') {
          results.networks.push({ slug, name, url });
        } else if (taxonomy === 'franchise') {
          results.franchises.push({ slug, name, url });
        }
      } else if (parts.length === 1) {
        // /category/term/ pattern (top-level categories)
        const slug = parts[0];
        const name = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        results.topLevel.push({ slug, name, url });
      }
    }
  } else {
    // Parse HTML page - extract <a> tags with category links
    const categoryRegex = /<a[^>]+href="([^"]*\/category\/([^"]+))["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;

    while ((m = categoryRegex.exec(html)) !== null) {
      const url = m[1];
      const path = m[2];
      let name = m[3].replace(/<[^>]+>/g, "").trim();

      if (!name || name.length > 50 || name.length < 2) continue;

      const nameLower = name.toLowerCase();
      if (nameLower === 'all' || nameLower === 'view all') continue;

      const parts = path.split('/').filter(p => p);
      
      if (parts.length === 2) {
        const taxonomy = parts[0];
        const slug = parts[1].replace(/\/$/, '');
        
        if (taxonomy === 'genre') {
          results.genres.push({ slug, name, url });
        } else if (taxonomy === 'language') {
          results.languages.push({ slug, name, url });
        } else if (taxonomy === 'type') {
          results.types.push({ slug, name, url });
        } else if (taxonomy === 'status') {
          results.statuses.push({ slug, name, url });
        } else if (taxonomy === 'network') {
          results.networks.push({ slug, name, url });
        } else if (taxonomy === 'franchise') {
          results.franchises.push({ slug, name, url });
        }
      } else if (parts.length === 1) {
        const slug = parts[0].replace(/\/$/, '');
        results.topLevel.push({ slug, name, url });
      }
    }
  }

  // Deduplicate
  for (const key in results) {
    results[key] = results[key].filter((item, index, self) =>
      index === self.findIndex(t => t.slug === item.slug)
    );
  }

  return results;
}

// ===========================================================================
// HOMEPAGE SECTION SPLITTER (CPU-OPTIMIZED)
// ===========================================================================
export const HOME_SECTION_TITLES = [
  "Most-Watched Series",
  "Most-Watched Films",
  "Fresh Drops",
  "On-Air Series",
  "New Anime Arrivals",
  "Just In: Cartoon Series",
  "Latest Anime Movies",
  "Fresh Cartoon Films",
  "Latest Episodes",
];

function titleRegex(title) {
  const words = title.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return new RegExp(words.join("[^A-Za-z0-9]{0,3}"), "i");
}

function scriptStyleRanges(html) {
  const ranges = [];
  const re = /<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function isInsideRanges(ranges, idx) {
  for (let i = 0; i < ranges.length; i++) {
    if (idx >= ranges[i][0] && idx < ranges[i][1]) return true;
    if (ranges[i][0] > idx) break;
  }
  return false;
}

function findSectionStart(html, title, ranges) {
  const re = titleRegex(title);
  let m;
  while ((m = re.exec(html)) !== null) {
    if (ranges && isInsideRanges(ranges, m.index)) continue;
    const back = html.lastIndexOf("<", m.index);
    if (back === -1 || m.index - back > 200) continue;
    const tagMatch = html.slice(back, back + 40).match(/^<\s*([a-zA-Z0-9]+)/);
    const tag = tagMatch ? tagMatch[1].toLowerCase() : "";
    if (tag === "a" || tag === "option" || tag === "script" || tag === "style") continue;
    return m.index;
  }
  return -1;
}

export function extractHomeSections(html) {
  const ranges = scriptStyleRanges(html);
  const positions = [];
  for (const title of HOME_SECTION_TITLES) {
    const idx = findSectionStart(html, title, ranges);
    if (idx !== -1) positions.push({ title, idx });
  }
  positions.sort((a, b) => a.idx - b.idx);

  const sections = {};
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].idx;
    const end = i + 1 < positions.length ? positions[i + 1].idx : html.length;
    const slice = html.slice(start, end);

    let items = extractPopularItems(slice);
    if (!items.length) items = extractAnimeList(slice);

    items = items
      .map(it => ({
        ...it,
        type: it.url && it.url.includes("/movies/") ? "movie" : (it.type || "series"),
      }))
      .slice(0, 25);

    sections[positions[i].title] = items;
  }
  return sections;
}