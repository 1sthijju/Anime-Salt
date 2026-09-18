// ---------------------------------------------------------------------------
// AnimeSalt Edge API — HTML parsers
// All functions are pure: (html, ...) -> data
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Generic card grids (home, category, search pages)
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
    const titleMatch = h.match(/class="[^"]*(?:entry-title|title)[^"]*"[^>]*>([^<]+)/i) || h.match(/alt="([^"]+)"/i);
    const title = titleMatch ? titleMatch[1].trim() : "";
    const imgMatch =
      h.match(/\bdata-src="([^"]+)"/i) ||
      h.match(/\bdata-lazy-src="([^"]+)"/i) ||
      h.match(/\bdata-original="([^"]+)"/i) ||
      h.match(/\bsrc="([^"]+)"/i);
    let image = imgMatch ? imgMatch[1] : "";
    if (image.startsWith("data:")) image = "";
    if (image.startsWith("//")) image = "https:" + image;
    results.push({ id, title, image, type: url.includes("/movies/") ? "movie" : "series", url });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Ranked chart blocks (Most-Watched Series / Films)
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
    const titleMatch = itemHtml.match(/class="[^"]*chart-title[^"]*"[^>]*>([^<]+)/i) || itemHtml.match(/alt="([^"]+)"/i);
    const title = titleMatch ? titleMatch[1].trim() : "";
    const imgMatch =
      itemHtml.match(/\bdata-src="([^"]+)"/i) ||
      itemHtml.match(/\bdata-lazy-src="([^"]+)"/i) ||
      itemHtml.match(/\bsrc="([^"]+)"/i);
    let image = imgMatch ? imgMatch[1] : "";
    if (image.startsWith("data:")) image = "";
    if (image.startsWith("//")) image = "https:" + image;
    if (!results.find(r => r.id === id)) results.push({ rank, id, title, image, type, url });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Episode grid (WordPress AJAX fragment)
// - thumbnails: inside the <a> first, then nearest <img> in an 800-char
//   window BEFORE the link (sibling card layout)
// - regionalDub: flips to false after the
//   "Below episodes aren't dubbed in regional languages" divider
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
      const lazy = tag.match(/\b(?:data-lazy-src|data-original|data-src|data-cfsrc|data-bg|data-lazy|data-echo)="([^"]+)"/i);
      const srcset = tag.match(/\bdata-srcset="([^"]+)"/i) || tag.match(/\bsrcset="([^"]+)"/i);
      const plain = tag.match(/\bsrc="([^"]+)"/i);
      let u = lazy ? lazy[1] : (srcset ? srcset[1].split(/[ ,]/)[0] : (plain && !plain[1].startsWith("data:") ? plain[1] : ""));
      if (u && !u.startsWith("data:")) return u;
    }
    const bg = fragment.match(/background(?:-image)?:\s*(?:[^;'"()]*?,\s*)?url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
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
      match[2].match(/class="[^"]*(?:entry-title|title)[^"]*"[^>]*>([^<]+)/i) ||
      match[2].match(/>([^<]+)</i);
    const title = titleMatch
      ? titleMatch[1].trim().replace(/^\d+\s*/, "").replace(/\s*View\s*$/i, "").trim()
      : `Episode ${epNum}`;

    // thumbnail: inside anchor → else nearest img before it
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
// Server iframe embed for a given server index
// ---------------------------------------------------------------------------
export function extractEmbedForIndex(html, index) {
  const containerRegex = new RegExp(
    `<div[^>]*id="options-${index}"[^>]*>([\\s\\S]*?)(?=<div[^>]*id="options-\\d+|<div[^>]*class="[^"]*(?:server-section|download|related)[^"]*"|</section>|<footer[^>]*>|$)`,
    'i'
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
// Taxonomy link lists (genre / language / country / ...)
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
    if (!name) name = slug.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    if (slug && name && !results.find(r => r.slug === slug)) {
      results.push({ slug, name, url: fullUrl });
    }
  }
  return results;
}

// ===========================================================================
// HOMEPAGE SECTION SPLITTER
// Slices the homepage HTML at each known section heading and extracts
// the cards that live between two headings.
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

// "Just In: Cartoon Series" -> /Just[^A-Za-z0-9]{0,3}In[^A-Za-z0-9]{0,3}Cartoon.../i
function titleRegex(title) {
  const words = title.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return new RegExp(words.join("[^A-Za-z0-9]{0,3}"), "i");
}

function isInsideScriptOrStyle(html, idx) {
  const before = html.slice(0, idx);
  if (before.lastIndexOf("<script") > before.lastIndexOf("</script")) return true;
  if (before.lastIndexOf("<style") > before.lastIndexOf("</style")) return true;
  return false;
}

// First occurrence of the title that is a HEADING, not a nav/menu link
function findSectionStart(html, title) {
  const re = titleRegex(title);
  let m;
  while ((m = re.exec(html)) !== null) {
    if (isInsideScriptOrStyle(html, m.index)) continue;
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
  const positions = [];
  for (const title of HOME_SECTION_TITLES) {
    const idx = findSectionStart(html, title);
    if (idx !== -1) positions.push({ title, idx });
  }
  positions.sort((a, b) => a.idx - b.idx);

  const sections = {};
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].idx;
    const end = i + 1 < positions.length ? positions[i + 1].idx : html.length;
    const slice = html.slice(start, end);

    let items = extractPopularItems(slice);          // ranked chart blocks
    if (!items.length) items = extractAnimeList(slice); // article grids

    items = items.map(it => ({
      ...it,
      type: it.url && it.url.includes("/movies/") ? "movie" : (it.type || "series"),
    })).slice(0, 25);

    sections[positions[i].title] = items;
  }
  return sections;
}