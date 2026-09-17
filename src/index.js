// ==========================================
// UPSTREAM TARGET (The Reverse Proxy)
// ==========================================
const PROXY_BASE = "https://animesalt-proxy.v1nx.workers.dev";

// ==========================================
// 1. HTML PARSING UTILITIES
// ==========================================

// Helper to cleanly extract text between tags or markers
function extractBetween(html, startMarker, endMarker) {
    const startIdx = html.indexOf(startMarker);
    if (startIdx === -1) return "";
    const endIdx = html.indexOf(endMarker, startIdx + startMarker.length);
    if (endIdx === -1) return "";
    return html.substring(startIdx + startMarker.length, endIdx).trim();
}

// Helper to extract Regex matches globally
function extractAll(html, regex) {
    const results = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
        results.push(match);
    }
    return results;
}

// ==========================================
// 2. PROXY SCRAPERS
// ==========================================

async function scrapeSearch(query) {
    const res = await fetch(`${PROXY_BASE}/?s=${encodeURIComponent(query)}`, { 
        headers: { "User-Agent": "Mozilla/5.0" } 
    });
    const html = await res.text();
    
    // The proxy returns a grid of "View Movie" or "View Serie" links.
    // We extract the href and the title from the article containers.
    const regex = /<article[^>]*class="[^"]*post[^"]*"[^>]*>[\s\S]*?<a\s+href="([^"]+)"[\s\S]*?<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/div>/gi;
    const results = extractAll(html, regex).map(m => ({
        url: m[1],
        slug: m[1].split('/').filter(Boolean).pop(),
        title: m[2].trim(),
        type: html.includes('View Movie') ? 'movie' : 'series'
    }));
    
    return { query, results };
}

async function scrapeAnimeInfo(slug) {
    const res = await fetch(`${PROXY_BASE}/anime/${slug}/`, { 
        headers: { "User-Agent": "Mozilla/5.0" } 
    });
    if (!res.ok) throw new Error(`Anime not found: ${slug}`);
    const html = await res.text();
    
    const title = extractBetween(html, '<h1', '</h1>').replace(/<[^>]+>/g, '').trim();
    const overview = extractBetween(html, 'Overview</h3>', 'Read More').replace(/<[^>]+>/g, '').trim();
    
    // Extract metadata stats
    const statsRegex = /(\d+)\s*Seasons|(\d+)\s*Episodes|(\d+)\s*min|(\d{4})/g;
    const stats = extractAll(html, statsRegex);
    const meta = {};
    stats.forEach(s => {
        if (s[1]) meta.seasons = parseInt(s[1]);
        if (s[2]) meta.episodes = parseInt(s[2]);
        if (s[3]) meta.duration = `${s[3]} min`;
        if (s[4]) meta.year = parseInt(s[4]);
    });

    // Extract Genres
    const genresRaw = extractBetween(html, 'Genres</h4>', 'Languages').replace(/<[^>]+>/g, '').trim();
    meta.genres = genresRaw.split(/\s+/).filter(g => g.length > 1);

    // Extract Languages
    const langsRaw = extractBetween(html, 'Languages</h4>', '</div>').replace(/<[^>]+>/g, '').trim();
    meta.languages = langsRaw.split(/\s+/).filter(l => l.length > 1);

    return { slug, title, overview, ...meta };
}

async function scrapeEpisodeServers(epSlug) {
    const res = await fetch(`${PROXY_BASE}/episode/${epSlug}/`, { 
        headers: { "User-Agent": "Mozilla/5.0" } 
    });
    if (!res.ok) throw new Error(`Episode not found: ${epSlug}`);
    const html = await res.text();
    
    // Extract Server Buttons & Iframe URLs
    const serverRegex = /<div[^>]*id="options-(\d+)"[^>]*>[\s\S]*?<iframe[^>]*(?:src|data-src)="([^"]+)"/gi;
    const servers = extractAll(html, serverRegex).map(m => {
        const url = m[2];
        let host = "unknown";
        if (url.includes('as-cdn26')) host = "as-cdn26.top";
        else if (url.includes('multi-lang-plyr') || url.includes('short.icu')) host = "abysscdn.com";
        else if (url.includes('mega')) host = "mega.nz";
        
        return { server_id: parseInt(m[1]), host, embed_url: url };
    });

    // Extract Download Table (Mega links)
    const downloadRegex = /<tr[^>]*>[\s\S]*?<td[^>]*>(.*?)<\/td>[\s\S]*?<td[^>]*>(.*?)<\/td>[\s\S]*?<td[^>]*>(.*?)<\/td>[\s\S]*?<a\s+href="([^"]+)"/gi;
    const downloads = extractAll(html, downloadRegex).map(m => ({
        server: m[1].trim(),
        lang: m[2].trim(),
        quality: m[3].trim(),
        url: m[4]
    }));

    return { episode_id: epSlug, servers, downloads };
}

// ==========================================
// 3. NATIVE ROUTER
// ==========================================

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } });
    }

    try {
      if (path === "/api/health") return jsonResponse({ status: "operational", upstream: PROXY_BASE });

      if (path === "/api/search") {
        const query = url.searchParams.get("q");
        if (!query) return jsonResponse({ error: "Missing query 'q'" }, 400);
        return jsonResponse(await scrapeSearch(query));
      }

      if (path === "/api/info") {
        const slug = url.searchParams.get("slug") || url.searchParams.get("id");
        if (!slug) return jsonResponse({ error: "Missing slug" }, 400);
        return jsonResponse(await scrapeAnimeInfo(slug));
      }

      if (path === "/api/servers") {
        const ep = url.searchParams.get("ep");
        if (!ep) return jsonResponse({ error: "Missing episode id" }, 400);
        return jsonResponse(await scrapeEpisodeServers(ep));
      }
      
      if (path === "/") {
        return jsonResponse({ 
            message: "AnimeSalt Reverse-Proxy API", 
            endpoints: ["/api/search?q=", "/api/info?slug=", "/api/servers?ep="] 
        });
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }
};