export function stripScriptsStyles(html) {
  return html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, match => ' '.repeat(match.length));
}

export function extractAnimeList(html) {
  const cards = [];
  const seen = new Set();
  // Matches ANY anchor tag linking to series or movies, regardless of wrapper tag
  const linkRegex = /<a[^>]+href="([^"]+\/(?:series|movies)\/[^/]+\/?)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    const content = match[2];
    const slugMatch = url.match(/(?:series|movies)\/([^/]+)/);
    if (!slugMatch) continue;
    const id = slugMatch[1];
    
    if (seen.has(id)) continue; // Deduplicate cards
    seen.add(id);
    
    let title = content.replace(/<[^>]+>/g, '').trim();
    if (!title) {
      const titleAttr = match[0].match(/title="([^"]+)"/i);
      if (titleAttr) title = titleAttr[1];
    }
    
    let image = "";
    // Look for image inside the anchor, or just before it (within 500 chars)
    const imgInside = content.match(/<img[^>]+>/i);
    const beforeText = html.substring(Math.max(0, match.index - 500), match.index);
    const imgBefore = beforeText.match(/<img[^>]+>/gi)?.pop();
    
    const imgMatch = imgInside || imgBefore;
    if (imgMatch) {
      const imgTag = Array.isArray(imgMatch) ? imgMatch[0] : imgMatch;
      const dataSrc = imgTag.match(/data-src="([^"]+)"/i);
      const src = imgTag.match(/\ssrc="([^"]+)"/i);
      let imgUrl = (dataSrc ? dataSrc[1] : (src ? src[1] : "")) || "";
      
      if (imgUrl && !imgUrl.startsWith("data:") && !/wp-content\/uploads\/.*(AnimeSalt|cropped-|icon\.png|logo\.png|favicon)/i.test(imgUrl)) {
        if (imgUrl.startsWith("//")) imgUrl = "https:" + imgUrl; // Normalize protocol
        image = imgUrl;
      }
    }
    
    cards.push({ id, title, image, type: url.includes("/movies/") ? "movies" : "series", url });
  }
  return cards;
}

export function extractHomeSections(html) {
  const cleanHtml = stripScriptsStyles(html);
  const headings = [
    "Most-Watched Series", "Most-Watched Films", "Fresh Drops", "On-Air Series",
    "New Anime Arrivals", "Just In: Cartoon Series", "Latest Anime Movies", 
    "Fresh Cartoon Films", "Latest Episodes"
  ];
  
  const sections = {};
  const map = { "Most-Watched Series": "mostWatchedSeries", "Most-Watched Films": "mostWatchedFilms", "Fresh Drops": "freshDrops", "On-Air Series": "ongoing", "New Anime Arrivals": "latest", "Just In: Cartoon Series": "popularSeries", "Latest Anime Movies": "movies", "Fresh Cartoon Films": "popularFilms", "Latest Episodes": "latestEpisodes" };
  
  // Simple text-splitting approach: finds the exact heading text and splits the HTML
  const indices = [];
  for (const h of headings) {
    const idx = cleanHtml.indexOf(h);
    if (idx !== -1) indices.push({ heading: h, index: idx + h.length });
  }
  indices.sort((a, b) => a.index - b.index);
  
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].index;
    const end = i + 1 < indices.length ? indices[i+1].index - indices[i+1].heading.length : cleanHtml.length;
    const sectionHtml = cleanHtml.substring(start, end);
    const cards = extractAnimeList(sectionHtml);
    
    const key = map[indices[i].heading];
    if (key) {
      if (key === "mostWatchedSeries" || key === "mostWatchedFilms") cards.forEach((c, idx) => c.rank = idx + 1);
      sections[key] = cards;
    }
  }
  return sections;
}

export function extractPostData(html) {
  // Permissive matching for WP post ID and nonce across classes, data attributes, and scripts
  const postMatch = html.match(/postid-(\d+)/i) || html.match(/data-(?:post|id)="(\d+)"/i);
  const nonceMatch = html.match(/["']nonce["']\s*:\s*["']([a-z0-9]+)["']/i) || 
                     html.match(/nonce\s*=\s*["']([a-z0-9]+)["']/i) ||
                     html.match(/_wpnonce["'][^"']*["']([a-z0-9]+)/i);
  return { postId: postMatch ? postMatch[1] : null, nonce: nonceMatch ? nonceMatch[1] : null };
}

export function extractPoster(html) {
  const h1Idx = html.indexOf("<h1");
  if (h1Idx === -1) return "";
  const beforeH1 = html.substring(0, h1Idx);
  const imgRegex = /<img[^>]+>/gi;
  let match, lastPortrait = "";
  
  while ((match = imgRegex.exec(beforeH1)) !== null) {
    const srcMatch = match[0].match(/(?:data-src|src)="([^"]+)"/i);
    if (!srcMatch) continue;
    let src = srcMatch[1];
    if (src.startsWith("data:") || /wp-content\/uploads\/.*(AnimeSalt|cropped-|icon\.png|logo\.png|favicon)/i.test(src)) continue;
    if (/image\.tmdb\.org\/t\/p\/(w154|w185|w342|w500)/i.test(src)) {
      if (src.startsWith("//")) src = "https:" + src;
      lastPortrait = src;
    }
  }
  return lastPortrait;
}

export function extractBackdrop(html) {
  // Looks for landscape TMDB URLs in inline JSON, CSS backgrounds, or srcset
  const landscapeRegex = /(?:url\(|src=|srcset=|["'])(https?:\/\/image\.tmdb\.org\/t\/p\/(?:w780|w1280|w1920|original)\/[^"'\s)]+)/gi;
  let match;
  while ((match = landscapeRegex.exec(html)) !== null) {
    let url = match[1].replace(/\\\//g, '/'); 
    if (!/wp-content\/uploads\//i.test(url)) return url;
  }
  return "";
}

export function extractQuickPlay(text) {
  const qp = {};
  const first = text.match(/First\s*S?(\d+)E(\d+)/i);
  if (first) qp.first = { season: parseInt(first[1]), episode: parseInt(first[2]), slug: "" };
  const dub = text.match(/Latest\s+Dub\s*S?(\d+)E(\d+)/i);
  if (dub) qp.latestDub = { season: parseInt(dub[1]), episode: parseInt(dub[2]), slug: "" };
  const sub = text.match(/Latest\s+Sub\s*S?(\d+)E(\d+)/i);
  if (sub) qp.latestSub = { season: parseInt(sub[1]), episode: parseInt(sub[2]), slug: "" };
  return qp;
}