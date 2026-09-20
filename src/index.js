// ==========================================================================
// AnimeSalt Worker — Main entry point (v4.2.0)
// All API routes wired up
// ==========================================================================

import { corsHeaders } from "./config.js";
import { jsonSuccess, jsonError } from "./util/response.js";
import { handleHealth } from "./api/health.js";
import { handleHomeHero, handleHomeSection, HOME_SECTIONS } from "./api/home.js";
import { handleCatalog, handleRandom } from "./api/catalog.js";
import { handleDiscover, handleGenreList, handleTaxonomy, TAXONOMY_KINDS } from "./api/taxonomy.js";
import { handleSearch } from "./api/search.js";
import { handleInfo } from "./api/info.js";
import { handleEpisodes } from "./api/episodes.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ----- Health -----
      if (path === "/api/health") return await handleHealth(ctx);
      if (path === "/api/ping") {
        return jsonSuccess({
          pong: true,
          timestamp: new Date().toISOString(),
          worker: "v4.2.0-full",
        });
      }

      // ----- Modular Home -----
      if (path === "/api/home/hero") return await handleHomeHero(ctx);
      if (path.startsWith("/api/home/")) {
        const section = path.replace("/api/home/", "");
        return await handleHomeSection(section, ctx);
      }
      if (path === "/api/home") {
        return jsonSuccess({
          _deprecated: "Use /api/home/hero + /api/home/<section> in parallel",
          sections: HOME_SECTIONS,
        });
      }

      // ----- Random -----
      if (path === "/api/random") return await handleRandom(ctx);

      // ----- Catalog -----
      const catalogKinds = [
        "series", "movies", "anime", "cartoon",
        "ongoing", "completed", "fresh-drops",
        "popular", "popular/series", "popular/films",
      ];
      for (const kind of catalogKinds) {
        if (path === `/api/${kind}`) {
          return await handleCatalog(kind, ctx, url);
        }
      }

      // ----- Taxonomy -----
      if (path === "/api/discover") return await handleDiscover(ctx);
      if (path === "/api/genres") return await handleGenreList(ctx);
      for (const kind of TAXONOMY_KINDS) {
        const m = path.match(new RegExp(`^/api/${kind}/([^/]+)$`));
        if (m) {
          return await handleTaxonomy(kind, decodeURIComponent(m[1]), ctx, url);
        }
      }

      // ----- Search -----
      if (path === "/api/search") return await handleSearch(ctx, url);

      // ----- Info -----
      if (path === "/api/info") return await handleInfo(ctx, url);

      // ----- Episodes -----
      if (path.startsWith("/api/episodes/")) {
        const id = decodeURIComponent(path.replace("/api/episodes/", ""));
        return await handleEpisodes(id, ctx, url);
      }

      // ----- Root -----
      if (path === "/" || path === "") {
        return new Response(
          `AnimeSalt Worker v4.2.0\n\n` +
          `Health: /api/health\n` +
          `Home: /api/home/hero, /api/home/<section>\n` +
          `Catalog: /api/series, /api/movies, /api/anime, /api/cartoon\n` +
          `Status: /api/ongoing, /api/completed\n` +
          `Popular: /api/popular, /api/popular/series, /api/popular/films\n` +
          `Random: /api/random\n` +
          `Search: /api/search?keyword=<kw>\n` +
          `Taxonomy: /api/discover, /api/genres, /api/genre/<slug>\n` +
          `Info: /api/info?id=<id>\n` +
          `Episodes: /api/episodes/<id>?season=<n|all>\n`,
          {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      // ----- Catch-all -----
      return jsonError("Not found", 404);
    } catch (e) {
      return new Response(
        JSON.stringify({
          success: false,
          error: e.message,
          stack: e.stack,
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  },
};