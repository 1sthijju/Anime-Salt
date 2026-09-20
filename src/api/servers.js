// ==========================================================================
// /api/servers?ep=<slug> — episode server list
// ==========================================================================

import { fetchUpstream } from "../util/fetcher.js";
import { cached } from "../util/cache.js";
import { parseServers, decodeMultiLang } from "../parsers/servers.js";
import { TTL } from "../config.js";
import { jsonError } from "../util/response.js";

/**
 * /api/servers?ep=<slug>
 */
export async function handleServers(ctx, url) {
  const ep = url.searchParams.get("ep");
  if (!ep) return jsonError("Missing ep", 400);

  return cached(
    `srv:${ep}`,
    TTL.servers,
    async () => {
      const servers = parseServers(await fetchUpstream(`/episode/${ep}/`), ep);
      // Populate multi-lang languages from base64 payload
      for (const s of servers) {
        if (s.isMultiLang) {
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