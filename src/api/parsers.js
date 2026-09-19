export function stripScriptsStyles(html) {
  // Linear pass to replace scripts and styles with spaces to preserve indices
  // Matches <script>...</script> and <style>...</style> blocks
  return html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, match => ' '.repeat(match.length));
}

export function extractAnimeList(html) {
  const cards = [];
  // Matches WordPress <article> post containers
  const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  
  while ((match = articleRegex.exec(html)) !== null) {
    const content = match[1];
    
    // Matches anchor href for the detail page
    const linkMatch = content.match(/<a[^>]+href="([^"]+)"/i);
    if (!linkMatch) continue;
    const url = linkMatch[1];
    const slugMatch = url.match(/(?:series|movies|episode)\/([^/]+)\//i);
    const id = slugMatch ? slugMatch[1] : url;
    
    // Matches title in entry-title, title class, a title attr, or img alt
    let title = "";
    const titleMatch = content.match(/class="[^"]*entry-title[^"]*"[^>]*>([^<]+)</i) ||
                       content.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</i) ||
                       content.match(/<a[^>]+title="([^"]+)"/i) ||
                       content.match(/<img[^>]+alt="([^"]+)"/i);
    if (titleMatch) title = titleMatch[1].trim();
    
    // Matches img tag to extract lazy data-src or standard src
    const imgMatch = content.match(/<img[^>]+>/i);
    let image = "";
    if (imgMatch) {
      const imgTag = imgMatch[0];
      const dataSrc = imgTag.match(/data-src="([^"]+)"/i);
      const src = imgTag.match(/\ssrc="([^"]+)"/i); // \s ensures we don't match data-src
      const imgUrl = (dataSrc ? dataSrc[1] : (src ? src[1] : "")) || "";
      
      // Rejects data: placeholders and site branding assets
      if (imgUrl && !imgUrl.startsWith("data:") && 
          !/wp-content\/uploads\/.*(AnimeSalt|cropped-|icon\.png|logo\.png|favicon)/i.test(imgUrl)) {
        image = imgUrl;
      }
    }
    
    let type = "series";
    if (url.includes("/movies/")) type = "movies";
    
    cards.push({ id, title, image, type, url });
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
  const indices = [];
  
  // Precomputes heading locations for linear O(N) splitting
  for (const h of headings) {
    // Matches heading text wrapped in any HTML tag (e.g., <h2>Most-Watched Series</h2>)
    const regex = new RegExp(`<[^>]+>[^<]*${h.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}[^<]*</[^>]+>`, 'gi');
    let m;
    while ((m = regex.exec(cleanHtml)) !== null) {
      indices.push({ heading: h, index: m.index, length: m[0].length });
    }
  }
  indices.sort((a, b) => a.index - b.index);
  
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].index + indices[i].length;
    const end = i + 1 < indices.length ? indices[i+1].index : cleanHtml.length;
    const sectionHtml = cleanHtml.substring(start, end);
    const cards = extractAnimeList(sectionHtml);
    
    const map = {
      "Most-Watched Series": "mostWatchedSeries",
      "Most-Watched Films": "mostWatchedFilms",
      "Fresh Drops": "freshDrops",
      "On-Air Series": "ongoing",
      "New Anime Arrivals": "latest",
      "Just In: Cartoon Series": "popularSeries",
      "Latest Anime Movies": "movies",
      "Fresh Cartoon Films": "popularFilms",
      "Latest Episodes": "latestEpisodes"
    };
    
    const key = map[indices[i].heading];
    if (key) {
      if (key === "mostWatchedSeries" || key === "mostWatchedFilms") {
        cards.forEach((c, idx) => c.rank = idx + 1);
      }
      sections[key] = cards;
    }
  }
  return sections;
}

export function extractPostData(html) {
  let postId = null;
  let nonce = null;
  
  // Matches WP post ID from body class or data attribute
  const postMatch = html.match(/class="[^"]*postid-(\d+)[^"]*"/i) || html.match(/data-post="(\d+)"/i);
  if (postMatch) postId = postMatch[1];
  
  // Matches WP nonce from inline JS or hidden inputs
  const nonceMatch = html.match(/"nonce":"([^"]+)"/i) || html.match(/var\s+nonce\s*=\s*["']([^"']+)["']/i) || html.match(/name="nonce"\s+value="([^"]+)"/i);
  if (nonceMatch) nonce = nonceMatch[1];
  
  return { postId, nonce };
}

export function extractPoster(html) {
  const h1Idx = html.indexOf("<h1");
  if (h1Idx === -1) return "";
  const beforeH1 = html.substring(0, h1Idx);
  
  const imgRegex = /<img[^>]+>/gi;
  let match;
  let lastPortrait = "";
  
  // Iterates images before H1 to find the LAST portrait TMDB image
  while ((match = imgRegex.exec(beforeH1)) !== null) {
    const tag = match[0];
    const srcMatch = tag.match(/(?:data-src|src)="([^"]+)"/i);
    if (!srcMatch) continue;
    let src = srcMatch[1];
    if (src.startsWith("data:")) continue;
    if (/wp-content\/uploads\/.*(AnimeSalt|cropped-|icon\.png|logo\.png|favicon)/i.test(src)) continue;
    
    // Matches portrait TMDB sizes
    if (/image\.tmdb\.org\/t\/p\/(w154|w185|w342|w500)/i.test(src)) {
      lastPortrait = src;
    }
  }
  return lastPortrait;
}

export function extractBackdrop(html) {
  // Matches landscape TMDB URLs in inline JSON/CSS (unescapes \/)
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
  // Matches "First S1E1", "Latest Dub S2E5", etc.
  const first = text.match(/First\s+S(\d+)E(\d+)/i);
  if (first) qp.first = { season: parseInt(first[1]), episode: parseInt(first[2]), slug: "" };
  
  const dub = text.match(/Latest\s+Dub\s+S(\d+)E(\d+)/i);
  if (dub) qp.latestDub = { season: parseInt(dub[1]), episode: parseInt(dub[2]), slug: "" };
  
  const sub = text.match(/Latest\s+Sub\s+S(\d+)E(\d+)/i);
  if (sub) qp.latestSub = { season: parseInt(sub[1]), episode: parseInt(sub[2]), slug: "" };
  
  return qp;
}