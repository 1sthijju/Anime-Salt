// ==========================================================================
// Shared constants — single source of truth
// ==========================================================================

export const UPSTREAM = "https://animesalt-proxy.v1nx.workers.dev";

export const CHROME_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

// Cache TTLs in seconds
export const TTL = {
  hero:      60 * 60,       // 1h
  section:   30 * 60,       // 30m
  catalog:   6 * 3600,      // 6h
  info:      30 * 60,       // 30m
  episodes:  30 * 60,       // 30m
  servers:   5 * 60,        // 5m
  taxonomy:  24 * 3600,     // 24h
  random:    10 * 60,       // 10m
  health:    5 * 60,        // 5m
  stream:    0,             // never cache (tokenized)
};