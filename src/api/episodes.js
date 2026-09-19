import { siteAjax } from './net.js';

export async function fetchSeasonEpisodes(postId, nonces, season, temp = 0) {
  // Iterate through all extracted nonces until one succeeds
  for (const nonce of nonces) {
    const params = { 
      action: "action_select_temp", 
      temp: temp, 
      season: season, 
      post: postId, 
      nonce: nonce 
    };
    
    try {
      let html = await siteAjax(params);
      
      // Handle JSON responses from WP AJAX
      try {
        const json = JSON.parse(html);
        if (json.html) html = json.html;
        else if (json.data) html = json.data;
      } catch(e) {}
      
      // Check if we got valid HTML containing episode links
      if (html && !html.trim().startsWith("0") && !html.trim().startsWith("-1") && html.includes("/episode/")) {
        return parseEpisodesFromFragment(html);
      }
      
      // Try fallback action with the same nonce
      params.action = "action_select_season"; 
      html = await siteAjax(params);
      try {
        const json = JSON.parse(html);
        if (json.html) html = json.html;
        else if (json.data) html = json.data;
      } catch(e) {}
      
      if (html && !html.trim().startsWith("0") && !html.trim().startsWith("-1") && html.includes("/episode/")) {
        return parseEpisodesFromFragment(html);
      }
    } catch (e) { /* continue to next nonce */ }
  }
  return [];
}

export function parseEpisodesFromFragment(html) {
  const episodes = [];
  const divider = "Below episodes aren't dubbed in regional languages";
  let dividerIndex = html.indexOf(divider);
  if (dividerIndex === -1) dividerIndex = html.length;
  
  const linkRegex = /href="([^"]+\/episode\/[^"]+)"/gi;
  let match;
  
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    const slugMatch = url.match(/\/episode\/([^/]+)/);
    if (!slugMatch) continue;
    const slug = slugMatch[1];
    
    const sxeMatch = slug.match(/-(\d+)x(\d+)$/i) || slug.match(/-s(\d+)e(\d+)/i) || slug.match(/-episode-(\d+)/i);
    let season = 1, num = 1;
    if (sxeMatch) { 
      season = parseInt(sxeMatch[1], 10); 
      num = parseInt(sxeMatch[2], 10) || 1; 
    }
    
    const startIdx = Math.max(0, match.index - 500);
    const windowText = html.substring(startIdx, match.index + 500);
    
    let title = `Episode ${num}`;
    const titleMatch = windowText.match(/<(?:h[2-4]|span)[^>]*>([^<]+)<\//i);
    if (titleMatch) title = titleMatch[1].trim();
    
    const imgMatch = windowText.match(/<img[^>]+data-src="([^"]+)"[^>]*>/i) || windowText.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    
    let image = "";
    if (imgMatch) {
      let imgUrl = imgMatch[1];
      if (imgUrl && !imgUrl.startsWith("data:") && !/wp-content\/uploads\/.*(AnimeSalt|cropped-|icon\.png|logo\.png|favicon)/i.test(imgUrl)) {
        if (imgUrl.startsWith("//")) imgUrl = "https:" + imgUrl;
        image = imgUrl;
      }
    }
    
    episodes.push({ num, season, title, slug, url, image, regionalDub: match.index > dividerIndex ? false : true });
  }
  return episodes;
}