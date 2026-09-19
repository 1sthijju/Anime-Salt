// ---------------------------------------------------------------------------
// AnimeSalt Edge API — HTML parsers
// Pure functions: (html, ...) -> data. No side effects.
// Used by index.js for home, browse, search, detail parsing.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Generic card grids (home, category, search pages)
// Matches <article class="...post..."> blocks — the WordPress standard wrapper
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
    if (image.startsWith("data:")) image = "";         // lazy placeholder
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
//
// Features:
// - Thumbnail detection: inside the <a> first, then nearest <img> in an
//   800-char window BEFORE the link (sibling card layout used by animesalt).
// - Lazy-load aware: checks data-src, data-lazy-src, data-original, srcset,
//   and CSS background-image.
// - regionalDub flag: flips to false once the divider
//   "Below episodes aren't dubbed in regional languages" is encountered in
//   document order.
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
    // dub-divider detection (document order)
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

    const titleMatch =
      match[2].match(
        /class="[^"]*(?:entry-title|title)[^"]*"[^>]*>([^<]+)/i
      ) || match[2].match(/>([^<]+)</i);
    const title = titleMatch
      ? titleMatch[1].trim().replace(/^\d+\s*/, "").replace(/\s*View\s*$/i, "").trim()
      : `Episode ${epNum}`;

    // thumbnail: inside anchor → else nearest img in 800 chars before it
    let image = grabUrl(match[2]);
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
// Server iframe embed URL for a given server index (used by /api/servers &
// /api/stream). Each server lives in <div id="options-N">.
// ---------------------------------------------------------------------------
export function extractEmbedForIndex(html, index) {
  const containerRegex = new RegExp(
    `<div[^>]*id="options-${index}"[^>]*>([\\s\\S]*?)(?=<div[^>]*id="options-\\d+|<div[^>]*class="[^"]*(?:server-section|download|related)[^"]*"|</section>|<footer[^>]*>|$)`,
    "i"
  );
  const containerMatch = html.match(containerRegex);
  if (containerMatch) {
    const iframeMatch = containerMatch[1].match(
      /<iframe[^>]*(?:src|data-src)="([^"]+)"/i
    );
    if (iframeMatch && iframeMatch[1]) return iframeMatch[1];
  }
  // Fallback: walk all iframes in document order
  const iframeRegex = /<iframe[^>]*(?:src|data-src)="([^"]+)"/gi;
  let m, i = 0;
  while ((m = iframeRegex.exec(html)) !== null) {
    if (i === index) return m[1];
    i++;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Taxonomy link lists (genre / language / country / quality / season / studio / year)
// Returns [{slug, name, url}].
// ---------------------------------------------------------------------------
export function extractTaxonomy(html, tax) {
  const results = [];
  const regex = new RegExp(`href="([^"]*\\/${tax}\\/([^\\/"]+)\\/?)["']`, "gi");
  let m;
  while ((m = regex.exec(html)) !== null) {
    const fullUrl = m[1];
    const slug = m[2];
    const tagEnd = html.indexOf("</a>", m.index);
    const tagStart = html.lastIndexOf(">", m.index);
    let name = "";
    if (tagStart > -1 && tagEnd > tagStart) {
      name = html.substring(tagStart + 1, tagEnd).replace(/<[^>]+>/g, "").trim();
    }
    if (!name) {
      name = slug.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    }
    if (slug && name && !results.find(r => r.slug === slug)) {
      results.push({ slug, name, url: fullUrl });
    }
  }
  return results;
}

// ===========================================================================
// HOMEPAGE SECTION SPLITTER (CPU-OPTIMIZED)
//
// The homepage contains 9 known section headings. This function slices the
// HTML at each heading and extracts the cards that live between two headings.
//
// CRITICAL for CPU: precompute script/style byte-ranges ONCE, then test
// membership by range scan. The old implementation used html.slice(0, idx)
// per regex match (O(n²)) which caused Cloudflare 1102 CPU-limit crashes.
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

// "Just In: Cartoon Series" → /Just[^A-Za-z0-9]{0,3}In[^A-Za-z0-9]{0,3}Cartoon.../i
// Tolerates the flexible whitespace between words that the theme injects.
function titleRegex(title) {
  const words = title.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return new RegExp(words.join("[^A-Za-z0-9]{0,3}"), "i");
}

// Build sorted [start, end] byte-ranges for every <script> and <style> block.
// Called once per page, then passed into all section-start lookups.
function scriptStyleRanges(html) {
  const ranges = [];
  const re = /<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

// O(ranges) membership test. ranges is sorted by start; early-exit when we pass idx.
function isInsideRanges(ranges, idx) {
  for (let i = 0; i < ranges.length; i++) {
    if (idx >= ranges[i][0] && idx < ranges[i][1]) return true;
    if (ranges[i][0] > idx) break;
  }
  return false;
}

// Find the first occurrence of `title` that looks like a real heading
// (not a nav menu link, not inside script/style).
function findSectionStart(html, title, ranges) {
  const re = titleRegex(title);
  let m;
  while ((m = re.exec(html)) !== null) {
    if (ranges && isInsideRanges(ranges, m.index)) continue;
    const back = html.lastIndexOf("<", m.index);
    if (back === -1 || m.index - back > 200) continue;
    const tagMatch = html.slice(back, back + 40).match(/^<\s*([a-zA-Z0-9]+)/);
    const tag = tagMatch ? tagMatch[1].toLowerCase() : "";
    // Reject matches inside <a>, <option>, <script>, <style> — those are not section headings
    if (tag === "a" || tag === "option" || tag === "script" || tag === "style") {
      continue;
    }
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

    // Ranked chart blocks first (Most-Watched); else generic article grid.
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