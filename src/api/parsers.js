export function stripScriptsStyles(html) {
  return html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, match => ' '.repeat(match.length));
}

export function extractAnimeList(html) {
  const cards = [];
  const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  
  while ((match = articleRegex.exec(html)) !== null) {
    const content = match[1];
    const linkMatch = content.match(/<a[^>]+href="([^"]+)"/i);
    if (!linkMatch) continue;
    
    const url = linkMatch[1];
    const slugMatch = url.match(/(?:series|movies|episode)\/([^/]+)\//i);
    const id = slugMatch ? slugMatch[1] : url;
    
    // Robust title extraction: gets text content of entry-title or title class
    let title = "";
    const titleMatch = content.match(/class="[^"]*(?:entry-title|title)[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i) ||
                       content.match(/<a[^>]+title="([^"]+)"/i) ||
                       content.match(/<img[^>]+alt="([^"]+)"/i);
    if (titleMatch) title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    
    const imgMatch = content.match(/<img[^>]+>/i);
    let image = "";
    if (imgMatch) {
      const imgTag = imgMatch[0];
      const dataSrc = imgTag.match(/data-src="([^"]+)"/i);
      const src = imgTag.match(/\ssrc="([^"]+)"/i);
      const imgUrl = (dataSrc ? dataSrc[1] : (src ? src[1] : "")) || "";
      
      if (imgUrl && !imgUrl.startsWith("data:") && 
          !/wp-content\/uploads\/.*(AnimeSalt|cropped-|icon\.png|logo\.png|favicon)/i.test(imgUrl)) {
        image = imgUrl;
      }
    }
    
    cards.push({ id, title, image, type: url.includes("/movies/") ? "movies" : "series", url });
  }
  return cards;
}

export function extractHomeSections(html) {
  const cleanHtml = stripScriptsStyles(html);
  const headings = ["Most-Watched Series", "Most-Watched Films", "Fresh Drops", "On-Air Series", "New Anime Arrivals", "Just In: Cartoon Series", "Latest Anime Movies", "Fresh Cartoon Films", "Latest Episodes"];
  const indices = [];
  
  // Backward-DOM-Walk: Finds text node, then walks back to find valid enclosing tag
  for (const h of headings) {
    let searchIdx = 0;
    while (true) {
      const textIdx = cleanHtml.indexOf(h, searchIdx);
      if (textIdx === -1) break;
      
      let tagStart = cleanHtml.lastIndexOf('<', textIdx);
      if (tagStart !== -1) {
        const tagMatch = cleanHtml.substring(tagStart, textIdx).match(/<([a-z0-9]+)[^>]*>$/i);
        if (tagMatch) {
          const tagName = tagMatch[1].toLowerCase();
          if (!['script', 'style', 'option', 'a'].includes(tagName)) {
            const endTag = `</${tagName}>`;
            let tagEnd = cleanHtml.indexOf(endTag, textIdx);
            if (tagEnd !== -1) {
               tagEnd += endTag.length;
               indices.push({ heading: h, start: tagEnd, index: tagStart });
            }
          }
        }
      }
      searchIdx = textIdx + h.length;
    }
  }
  
  indices.sort((a, b) => a.index - b.index);
  const sections = {};
  const map = { "Most-Watched Series": "mostWatchedSeries", "Most-Watched Films": "mostWatchedFilms", "Fresh Drops": "freshDrops", "On-Air Series": "ongoing", "New Anime Arrivals": "latest", "Just In: Cartoon Series": "popularSeries", "Latest Anime Movies": "movies", "Fresh Cartoon Films": "popularFilms", "Latest Episodes": "latestEpisodes" };
  
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].start;
    const end = i + 1 < indices.length ? indices[i+1].index : cleanHtml.length;
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
  const postMatch = html.match(/class="[^"]*postid-(\d+)[^"]*"/i) || html.match(/data-post="(\d+)"/i);
  const nonceMatch = html.match(/"nonce":"([^"]+)"/i) || html.match(/var\s+nonce\s*=\s*["']([^"']+)["']/i) || html.match(/name="nonce"\s+value="([^"]+)"/i);
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
    if (/image\.tmdb\.org\/t\/p\/(w154|w185|w342|w500)/i.test(src)) lastPortrait = src;
  }
  return lastPortrait;
}

export function extractBackdrop(html) {
  const landscapeRegex = /(https?:\/\/image\.tmdb\.org\/t\/p\/(w780|w1280|w1920|original)\/[^"'\s]+)/gi;
  let match;
  while ((match = landscapeRegex.exec(html)) !== null) {
    let url = match[1].replace(/\\\//g, '/'); 
    if (!/wp-content\/uploads\//i.test(url)) return url;
  }
  return "";
}

export function extractQuickPlay(text) {
  const qp = {};
  const first = text.match(/First\s+S(\d+)E(\d+)/i);
  if (first) qp.first = { season: parseInt(first[1]), episode: parseInt(first[2]), slug: "" };
  const dub = text.match(/Latest\s+Dub\s+S(\d+)E(\d+)/i);
  if (dub) qp.latestDub = { season: parseInt(dub[1]), episode: parseInt(dub[2]), slug: "" };
  const sub = text.match(/Latest\s+Sub\s+S(\d+)E(\d+)/i);
  if (sub) qp.latestSub = { season: parseInt(sub[1]), episode: parseInt(sub[2]), slug: "" };
  return qp;
}