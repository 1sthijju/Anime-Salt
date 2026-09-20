// ==========================================================================
// AnimeSalt Worker — Main entry point (v4.1.0)
// Wires up modular API routes
// ==========================================================================

import { corsHeaders } from "./config.js";
import { jsonSuccess, jsonError } from "./util/response.js";
import { handleHealth } from "./api/health.js";
import { handleHomeHero, handleHomeSection, HOME_SECTIONS } from "./api/home.js";
import { handleCatalog, handleRandom } from "./api/catalog.js";

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
          worker: "v4.1.0-modular",
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
        "series",
        "movies",
        "anime",
        "cartoon",
        "ongoing",
        "completed",
        "fresh-drops",
        "popular",
        "popular/series",
        "popular/films",
      ];
      for (const kind of catalogKinds) {
        if (path === `/api/${kind}`) {
          return await handleCatalog(kind, ctx, url);
        }
      }

      // ----- Root -----
      if (path === "/" || path === "") {
        return new Response(
          `AnimeSalt Worker v4.1.0\n\n` +
            `Modular home: /api/home/hero, /api/home/<section>\n` +
            `Sections: ${HOME_SECTIONS.join(", ")}\n` +
            `Catalog: /api/series, /api/movies, /api/anime, /api/cartoon\n` +
            `Status: /api/ongoing, /api/completed\n` +
            `Popular: /api/popular, /api/popular/series, /api/popular/films\n` +
            `Random: /api/random\n` +
            `Health: /api/health\n`,
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