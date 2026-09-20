// ==========================================================================
// AnimeSalt Worker — Main Router (v4.6.0-megaplay)
// ==========================================================================

import { corsHeaders, UPSTREAM, CHROME_HEADERS } from "./config.js";
import { jsonSuccess, jsonError } from "./util/response.js";

import { handleHealth } from "./api/health.js";
import {
  handleHomeHero,
  handleHomeSection,
  handleHomeDebug,
  HOME_SECTIONS,
} from "./api/home.js";
import { handleCatalog, handleRandom, handleLetter } from "./api/catalog.js";
import {
  handleDiscover,
  handleGenreList,
  handleTaxonomy,
  TAXONOMY_KINDS,
} from "./api/taxonomy.js";
import { handleSearch } from "./api/search.js";
import { handleInfo } from "./api/info.js";
import { handleEpisodes } from "./api/episodes.js";
import { handleServers } from "./api/servers.js";
import { handleStream } from "./api/stream.js";
import { handleMediaProxy } from "./proxy/media.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // ---------- CORS preflight ----------
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ---------- health ----------
      if (path === "/api/health") return await handleHealth(ctx);
      if (path === "/api/ping") {
        return jsonSuccess({
          pong: true,
          timestamp: new Date().toISOString(),
          worker: "v4.6.0-megaplay",
        });
      }

      // ---------- home (modular sections) ----------
      if (path === "/api/home/hero") return await handleHomeHero(ctx);
      if (path === "/api/debug/home") return await handleHomeDebug(ctx);
      if (path.startsWith("/api/home/")) {
        const section = path.replace("/api/home/", "");
        return await handleHomeSection(section, ctx);
      }
      if (path === "/api/home") {
        return jsonSuccess({
          _note: "Use /api/home/hero + /api/home/<section> in parallel",
          sections: HOME_SECTIONS,
        });
      }

      // ---------- random ----------
      if (path === "/api/random") return await handleRandom(ctx);

      // ---------- catalog ----------
      const catalogKinds = [
        "series", "movies", "anime", "cartoon",
        "ongoing", "completed", "fresh-drops",
        "popular", "popular/series", "popular/films",
      ];
      for (const kind of catalogKinds) {
        if (path === `/api/${kind}`) return await handleCatalog(kind, ctx, url);
      }

      // ---------- letter browse: /api/letter/<A-Z|#> ----------
      const letterM = path.match(/^\/api\/letter\/([#A-Za-z])$/);
      if (letterM) return await handleLetter(letterM[1], ctx);

      // ---------- taxonomy ----------
      if (path === "/api/discover") return await handleDiscover(ctx);
      if (path === "/api/genres") return await handleGenreList(ctx);
      for (const kind of TAXONOMY_KINDS) {
        const m = path.match(new RegExp(`^/api/${kind}/([^/]+)$`));
        if (m) return await handleTaxonomy(kind, decodeURIComponent(m[1]), ctx, url);
      }

      // ---------- search & info ----------
      if (path === "/api/search") return await handleSearch(ctx, url);
      if (path === "/api/info") return await handleInfo(ctx, url);

      // ---------- episodes ----------
      if (path.startsWith("/api/episodes/")) {
        const id = decodeURIComponent(path.replace("/api/episodes/", ""));
        return await handleEpisodes(id, ctx, url);
      }

      // ---------- streaming ----------
      if (path === "/api/servers") return await handleServers(ctx, url);
      if (path === "/api/stream") return await handleStream(ctx, url);

      // ---------- media proxy ----------
      if (path === "/proxy/media") return await handleMediaProxy(request);

      // ---------- debug: dump any embed page ----------
      if (path === "/api/debug/embed") {
        const u = url.searchParams.get("url");
        if (!u) return jsonError("Missing url", 400);
        try {
          const res = await fetch(u, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
              Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              "Sec-Ch-Ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
              "Sec-Ch-Ua-Platform": '"Windows"',
              "Sec-Fetch-Dest": "iframe",
              "Sec-Fetch-Mode": "navigate",
              "Sec-Fetch-Site": "cross-site",
              Referer: "https://animesalt.cx/",
            },
            redirect: "follow",
          });
          return new Response(await res.text(), {
            headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" },
          });
        } catch (e) {
          return jsonError(e.message, 500);
        }
      }

      // ---------- audit (upstream-only) ----------
      if (path === "/api/debug/audit") return await handleAudit();

      // ---------- root ----------
      if (path === "/" || path === "") {
        return new Response(
          `AnimeSalt Worker v4.6.0-megaplay\n\n` +
          `Home:      /api/home/hero, /api/home/<section>\n` +
          `Sections:  ${HOME_SECTIONS.join(", ")}\n` +
          `Letters:   /api/letter/<A-Z|#>\n` +
          `Catalog:   /api/series, /api/movies, /api/anime, /api/cartoon, /api/ongoing, /api/completed, /api/popular[/series|/films]\n` +
          `Taxonomy:  /api/discover, /api/genres, /api/<kind>/<slug>\n` +
          `Search:    /api/search?keyword=<kw>\n` +
          `Info:      /api/info?id=<id>[&debug=1]\n` +
          `Episodes:  /api/episodes/<id>?season=<n|all>\n` +
          `Streaming: /api/servers?ep=<slug>, /api/stream?ep=<slug>&server=<n>&lang=<l>\n` +
          `Proxy:     /proxy/media?url=<url>&referer=<r>&force=text/vtt\n` +
          `Debug:     /api/debug/home, /api/debug/embed, /api/debug/audit, /api/health\n`,
          {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      // ---------- 404 ----------
      return jsonError("Not found", 404);
    } catch (e) {
      return new Response(
        JSON.stringify({ success: false, error: e.message || "Internal error", stack: e.stack }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }
      );
    }
  },
};

// ==========================================================================
// Upstream-only audit (route self-probes are unreliable inside a Worker)
// ==========================================================================
async function handleAudit() {
  const upstreams = [
    "/", "/series/", "/movies/", "/category/anime/", "/category/cartoon/",
    "/category/status/ongoing/", "/category/status/completed/", "/wp-sitemap.xml",
    "/letter/a/", "/letter/z/",
  ];
  const report = [];
  for (const u of upstreams) {
    try {
      const res = await fetch(UPSTREAM + u, { headers: CHROME_HEADERS, redirect: "follow" });
      report.push({ path: u, status: res.status, exists: res.status < 400 });
      try { if (res.body) await res.body.cancel(); } catch {}
    } catch {
      report.push({ path: u, status: "EXC", exists: false });
    }
  }
  return jsonSuccess({
    generatedAt: new Date().toISOString(),
    note: "Verify worker routes externally (self-fetch is unreliable in Workers).",
    upstream: report,
  });
}