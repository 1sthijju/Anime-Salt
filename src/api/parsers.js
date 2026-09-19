export function stripScriptsStyles(html) {
  return html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, match => ' '.repeat(match.length));
}

export function normalizeUrl(url) {
  if (!url) return "";
  if (url.startsWith("//")) return "https:" + url;
  return url;
}

export function extractAnimeList(html) {
  const cards = [];
  const seen = new Set();
  
  const linkRegex = /href="([^"]*(?:\/series\/|\/movies\/)[^"]+)"/gi;
  let match;
  
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    const slugMatch = url.match(/(?:series|movies)\/([^/]+)/);
    if (!slugMatch) continue;
    const id = slugMatch[1];
    
    if (seen.has(id)) continue; 
    seen.add(id);
    
    const afterText = html.substring(match.index, Math.min(html.length, match.index + 1500));
    const hMatchAfter = afterText.match(/<(?:h[1-4]|span|div|p)[^>]*class="[^"]*(?:title|entry-title|card-title)[^"]*"[^>]*>([^<]+)<\//i) ||
                        afterText.match(/<(?:h[1-4])[^>]*>\s*([^<]+)\s*<\//i);
    
    const beforeText = html.substring(Math.max(0, match.index - 500), match.index);
    const hMatchBefore = beforeText.match(/<(?:h[1-4]|span|div|p)[^>]*class="[^"]*(?:title|entry-title|card-title)[^"]*"[^>]*>([^<]+)<\//i) ||
                         beforeText.match(/<(?:h[1-4])[^>]*>\s*([^<]+)\s*<\//i);

    let title = "";
    if (hMatchAfter) title = hMatchAfter[1].trim();
    else if (hMatchBefore) title = hMatchBefore[1].trim();
    else {
        const windowText = html.substring(Math.max(0, match.index - 200), match.index + match[0].length);
        const altMatch = windowText.match(/(?:alt|title)="([^"]+)"/i);
        if (altMatch) {
            title = altMatch[1].trim();
            // Strip "Image " prefix often added by lazyload plugins
            if (title.startsWith("Image ")) title = title.substring(6);
        }
    }
    
    const imgWindow = html.substring(Math.max(0, match.index - 1000), Math.min(html.length, match.index + 1000));
    let image = "";
    const imgMatch = imgWindow.match(/<img[^>]+>/i);
    if (imgMatch) {
      const imgTag = imgMatch[0];
      const dataSrc = imgTag.match(/data-src="([^"]+)"/i);
      const src = imgTag.match(/\ssrc="([^"]+)"/i);
      let imgUrl = (dataSrc ? dataSrc[1] : (src ? src[1] : "")) || "";
      
      if (imgUrl && !imgUrl.startsWith("data:") && !/wp-content\/uploads\/.*(AnimeSalt|cropped-|icon\.png|logo\.png|favicon)/i.test(imgUrl)) {
        image = normalizeUrl(imgUrl);
      }
    }
    
    cards.push({ 
      id, 
      title: title || id, 
      image, 
      type: url.includes("/movies/") ? "movies" : "series", 
      url: normalizeUrl(url) 
    });
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
  
  const indices = [];
  for (const h of headings) {
    const idx = cleanHtml.toLowerCase().indexOf(h.toLowerCase());
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

// EXTRACTS ALL POTENTIAL NONCES TO BRUTE-FORCE WP AJAX
export function extractPostData(html) {
  const postMatch = html.match(/postid-(\d+)/i) || 
                    html.match(/post-(\d+)/i) || 
                    html.match(/data-(?:post|id)="(\d+)"/i) ||
                    html.match(/"id":(\d+)/i);
  const postId = postMatch ? postMatch[1] : null;
  
  const allNonces = [...html.matchAll(/["'](?:nonce|_wpnonce|security|ajax_nonce|select_nonce)["']\s*[:=]\s*["']([a-zA-Z0-9]{8,20})["']/gi)]
                      .map(m => m[1])
                      .filter((v, i, a) => a.indexOf(v) === i); // deduplicate
                      
  return { postId, nonces: allNonces };
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
      lastPortrait = normalizeUrl(src);
    }
  }
  return lastPortrait;
}

export function extractBackdrop(html) {
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