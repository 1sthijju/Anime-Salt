import { siteAjax } from './net.js';

export async function fetchSeasonEpisodes(postId, nonce, season, temp = 0) {
  const params = { action: "action_select_temp", temp, season, post: postId, nonce };
  
  try {
    let html = await siteAjax(params);
    // Strict check for WordPress "0" failure response
    if (!html || html.trim() === "0") {
      params.action = "action_select_season"; 
      html = await siteAjax(params);
    }
    if (html.trim() === "0") return [];
    return parseEpisodesFromFragment(html);
  } catch (e) {
    return [];
  }
}

export function parseEpisodesFromFragment(html) {
  const episodes = [];
  const divider = "Below episodes aren't dubbed in regional languages";
  let dividerIndex = html.indexOf(divider);
  if (dividerIndex === -1) dividerIndex = html.length;
  
  const linkRegex = /<a[^>]+href="([^"]+\/episode\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    const slugMatch = url.match(/\/episode\/([^/]+)/);
    if (!slugMatch) continue;
    const slug = slugMatch[1];
    
    const sxeMatch = slug.match(/-(\d+)x(\d+)$/i);
    let season = 1, num = 1;
    if (sxeMatch) { season = parseInt(sxeMatch[1], 10); num = parseInt(sxeMatch[2], 10); }
    
    const titleMatch = match[2].match(/>([^<]+)</);
    const title = titleMatch ? titleMatch[1].trim() : `Episode ${num}`;
    
    const startIdx = Math.max(0, match.index - 800);
    const windowText = html.substring(startIdx, match.index + match[0].length);
    const imgMatch = windowText.match(/<img[^>]+data-src="([^"]+)"[^>]*>/i) || windowText.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    
    let image = "";
    if (imgMatch) {
      let imgUrl = imgMatch[1];
      if (imgUrl && !imgUrl.startsWith("data:") && !/wp-content\/uploads\/.*(AnimeSalt|cropped-|icon\.png|logo\.png|favicon)/i.test(imgUrl)) image = imgUrl;
    }
    
    episodes.push({ num, season, title, slug, url, image, regionalDub: match.index > dividerIndex ? false : true });
  }
  return episodes;
}