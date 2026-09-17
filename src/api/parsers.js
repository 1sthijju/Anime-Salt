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