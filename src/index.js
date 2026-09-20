// ==========================================================================
// AnimeSalt Worker — Main Router (v4.3.0-final)
// Wires all modular API routes, CORS, and error handling
// ==========================================================================

import { corsHeaders } from "./config.js";
import { jsonSuccess, jsonError } from "./util/response.js";

// API Handlers
import { handleHealth } from "./api/health.js";
import { handleHomeHero, handleHomeSection, HOME_SECTIONS } from "./api/home.js";
import { handleCatalog, handleRandom } from "./api/catalog.js";
import { handleDiscover, handleGenreList, handleTaxonomy, TAXONOMY_KINDS } from "./api/taxonomy.js";
import { handleSearch } from "./api/search.js";
import { handleInfo } from "./api/info.js";
import { handleEpisodes } from "./api/episodes.js";
import { handleServers } from "./api/servers.js";
import { handleStream } from "./api/stream.js";

// Proxy & Utilities
import { handleMediaProxy } from "./proxy/media.js";
import { UPSTREAM, CHROME_HEADERS } from "./config.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // 1. CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ================= HEALTH & PING =================
      if (path === "/api/health") return await handleHealth(ctx);
      if (path === "/api/ping") {
        return jsonSuccess({
          pong: true,
          timestamp: new Date().toISOString(),
          worker: "v4.3.0-final",
        });
      }

      // ================= HOME (MODULAR) =================
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

      // ================= RANDOM =================
      if (path === "/api/random") return await handleRandom(ctx);

      // ================= CATALOG =================
      const catalogKinds = [
        "series", "movies", "anime", "cartoon",
        "ongoing", "completed", "fresh-drops",
        "popular", "popular/series", "popular/films",
      ];
      for (const kind of catalogKinds) {
        if (path === `/api/${kind}`) return await handleCatalog(kind, ctx, url);
      }

      // ================= TAXONOMY =================
      if (path === "/api/discover") return await handleDiscover(ctx);
      // NOTE: handleGenreList returns a Response object directly from cached()
      // DO NOT wrap in jsonSuccess() or it will return empty "{}"
      if (path === "/api/genres") return await handleGenreList(ctx);
      
      for (const kind of TAXONOMY_KINDS) {
        const m = path.match(new RegExp(`^/api/${kind}/([^/]+)$`));
        if (m) return await handleTaxonomy(kind, decodeURIComponent(m[1]), ctx, url);
      }

      // ================= SEARCH & INFO =================
      if (path === "/api/search") return await handleSearch(ctx, url);
      if (path === "/api/info") return await handleInfo(ctx, url);

      // ================= EPISODES =================
      if (path.startsWith("/api/episodes/")) {
        const id = decodeURIComponent(path.replace("/api/episodes/", ""));
        return await handleEpisodes(id, ctx, url);
      }

      // ================= STREAMING =================
      if (path === "/api/servers") return await handleServers(ctx, url);
      if (path === "/api/stream") return await handleStream(ctx, url);

      // ================= MEDIA PROXY =================
      if (path === "/proxy/media") return await handleMediaProxy(request);

      // ================= SELF-AUDIT =================
      if (path === "/api/debug/audit") return await handleAudit(url.origin);

      // ================= ROOT =================
      if (path === "/" || path === "") {
        return new Response(
          `AnimeSalt Worker v4.3.0-final\n\n` +
          `Endpoints:\n` +
          `  Health:     /api/health\n` +
          `  Home:       /api/home/hero, /api/home/<section>\n` +
          `  Catalog:    /api/series, /api/movies, /api/anime, /api/cartoon\n` +
          `  Status:     /api/ongoing, /api/completed\n` +
          `  Popular:    /api/popular, /api/popular/series, /api/popular/films\n` +
          `  Random:     /api/random\n` +
          `  Search:     /api/search?keyword=<kw>\n` +
          `  Taxonomy:   /api/discover, /api/genres, /api/genre/<slug>\n` +
          `  Info:       /api/info?id=<id>\n` +
          `  Episodes:   /api/episodes/<id>?season=<n|all>\n` +
          `  Servers:    /api/servers?ep=<slug>\n` +
          `  Stream:     /api/stream?ep=<slug>&server=<n>\n` +
          `  Audit:      /api/debug/audit\n`,
          {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      // ================= CATCH-ALL 404 =================
      return jsonError("Not found", 404);

    } catch (e) {
      // Global error handler
      return new Response(
        JSON.stringify({
          success: false,
          error: e.message || "Internal server error",
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

// ==========================================================================
// Self-Audit Helper (Probes routes to verify deployment health)
// ==========================================================================
async function handleAudit(workerOrigin) {
  const routes = [
    "/api/health", "/api/home/hero", "/api/home/latest",
    "/api/home/most-watched-series", "/api/home/most-watched-films",
    "/api/series?page=1", "/api/movies?page=1", "/api/anime?page=1",
    "/api/ongoing?page=1", "/api/completed?page=1", "/api/popular",
    "/api/random", "/api/discover", "/api/genres",
    "/api/genre/action?page=1", "/api/search?keyword=naruto",
    "/api/info?id=spy-x-family", "/api/episodes/spy-x-family?season=all",
    "/api/servers?ep=spy-x-family-1x1",
  ];

  const upstreams = [
    "/", "/series/", "/movies/", "/category/anime/", "/category/cartoon/",
    "/category/status/ongoing/", "/category/status/completed/",
  ];

  const routeReport = [];
  for (const r of routes) {
    try {
      const res = await fetch(workerOrigin + r);
      let items = null, err = null;
      try {
        const j = await res.json();
        const d = j.data || j;
        items = Array.isArray(d) ? d.length : (typeof d === 'object' ? Object.keys(d).length : 1);
        err = j.error || null;
      } catch {}
      routeReport.push({
        route: r, 
        status: res.status, 
        items, 
        error: err,
        discrepancy: res.status !== 200 || !!err || items === 0
      });
    } catch (e) {
      routeReport.push({ route: r, status: "EXC", error: e.message, discrepancy: true });
    }
  }

  const upstreamReport = [];
  for (const u of upstreams) {
    try {
      const res = await fetch(UPSTREAM + u, { headers: CHROME_HEADERS, redirect: "follow" });
      upstreamReport.push({ path: u, status: res.status, exists: res.status < 400 });
      try { if (res.body) await res.body.cancel(); } catch {}
    } catch (e) {
      upstreamReport.push({ path: u, status: "EXC", exists: false });
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        discrepancies: routeReport.filter((r) => r.discrepancy),
        routes: routeReport,
        upstream: upstreamReport,
      }
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      }
    }
  );
}