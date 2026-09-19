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
    const imgMatch = h.match(/data-src="([^"]+)"/i) || h.match(/src="([^"]+)"/i);
    let image = imgMatch ? imgMatch[1] : "";
    if (image.startsWith("//")) image = "https:" + image;
    results.push({ id, title, image, type: url.includes("/movies/") ? "movie" : "series", url });
  }
  return results;
}

export function extractPopularItems(html, targetType) {
  const results = [];
  const chartRegex = /<div[^>]*class="[^"]*chart-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let match;
  while ((match = chartRegex.exec(html)) !== null) {
    const itemHtml = match[1];
    const rankMatch = itemHtml.match(/class="[^"]*chart-number[^"]*"[^>]*>(\d+)/i);
    const rank = rankMatch ? parseInt(rankMatch[1]) : null;
    const linkMatch = itemHtml.match(/href="([^"]+\/(?:series|movies|anime)\/[^"]+)"/i);
    const url = linkMatch ? linkMatch[1] : "";
    const slugMatch = url.match(/\/(?:series|movies|anime)\/([^/]+)\/?$/);
    const id = slugMatch ? slugMatch[1] : "";
    if (!id) continue;
    const type = slugMatch && slugMatch[1] === "movies" ? "movie" : "series";
    if (targetType && type !== targetType) continue;
    const titleMatch = itemHtml.match(/class="[^"]*chart-title[^"]*"[^>]*>([^<]+)/i) || itemHtml.match(/alt="([^"]+)"/i);
    const title = titleMatch ? titleMatch[1].trim() : "";
    const imgMatch = itemHtml.match(/data-src="([^"]+)"/i) || itemHtml.match(/src="([^"]+)"/i);
    let image = imgMatch ? imgMatch[1] : "";
    if (image.startsWith("//")) image = "https:" + image;
    if (!results.find(r => r.id === id)) results.push({ rank, id, title, image, type, url });
  }
  return results;
}

export function parseEpisodesFromHtml(html, seasonNum) {
  const eps = [];
  const epRegex = /<a[^>]+href="([^"]+\/episode\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = epRegex.exec(html)) !== null) {
    const url = match[1];
    const slugMatch = url.match(/\/episode\/([^/]+)\/?$/);
    const epSlug = slugMatch ? slugMatch[1] : "";
    if (!epSlug) continue;
    const sxe = epSlug.match(/(\d+)x(\d+)$/);
    const sNum = sxe ? parseInt(sxe[1]) : seasonNum;
    const epNum = sxe ? parseInt(sxe[2]) : 0;
    if (epNum === 0) continue;
    const titleMatch = match[2].match(/class="[^"]*(?:entry-title|title)[^"]*"[^>]*>([^<]+)/i) || match[2].match(/>([^<]+)</i);
    const title = titleMatch ? titleMatch[1].trim().replace(/^\d+\s*/, "").replace(/\s*View\s*$/i, "").trim() : `Episode ${epNum}`;
    if (!eps.find(e => e.slug === epSlug)) eps.push({ num: epNum, season: sNum, title, slug: epSlug, url });
  }
  return eps;
}

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
// HOMEPAGE SECTION SPLITTER — matches actual animesalt.cx headings
// ===========================================================================
export const HOME_SECTION_TITLES = [
  "Most-Watched Series",
  "Most-Watched Films",
];

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

    let items = extractPopularItems(slice);
    if (!items.length) items = extractAnimeList(slice);

    items = items.map(it => ({
      ...it,
      type: it.url && it.url.includes("/movies/") ? "movie" : (it.type || "series"),
    })).slice(0, 25);

    sections[positions[i].title] = items;
  }
  return sections;
}