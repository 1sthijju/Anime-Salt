// ==========================================================================
// /api/servers?ep=<slug> — episode OR movie server list
// v2: tries /episode/ → /movies/ → /series/ so films resolve too
// ==========================================================================

import { fetchUpstream } from "../util/fetcher.js";
import { cached } from "../util/cache.js";
import { parseServers, decodeMultiLang } from "../parsers/servers.js";
import { TTL } from "../config.js";
import { jsonError } from "../util/response.js";

/**
 * Fetch the page that actually hosts the player for this slug.
 * Episodes: /episode/<slug>/   Movies: /movies/<slug>/   (series page last)
 */
async function fetchPlayerPage(ep) {
  const candidates = [
    `/episode/${ep}/`,
    `/movies/${ep}/`,
    `/series/${ep}/`,
  ];
  let lastErr;
  for (const path of candidates) {
    try {
      const html = await fetchUpstream(path);
      // reject soft-404 pages
      if (/404 Not Found|Page not found/i.test(html.slice(0, 3000))) continue;
      return html;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`No player page for ${ep}`);
}

/**
 * /api/servers?ep=<slug>
 */
export async function handleServers(ctx, url) {
  const ep = url.searchParams.get("ep");
  if (!ep) return jsonError("Missing ep", 400);

  return cached(
    `srv:v2:${ep}`, // bumped key: purges any stale state
    TTL.servers,
    async () => {
      const html = await fetchPlayerPage(ep);
      const servers = parseServers(html, ep);

      // Populate multi-lang languages from base64 payload
      for (const s of servers) {
        if (s.isMultiLang && !s.languages) {
          s.languages = decodeMultiLang(s.embedUrl).map((l) => ({
            language: l.language,
            link: String(l.link || "").replace(/\\\//g, "/"),
          }));
        }
      }
      return servers;
    },
    ctx
  );
}