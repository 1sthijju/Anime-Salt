// ==========================================================================
// AnimeSalt Worker — Main entry point (v4.0.0)
// This is a stub that proves deployment works. Real routes come in later batches.
// ==========================================================================

import { corsHeaders } from "./config.js";
import { jsonSuccess } from "./util/response.js";
import { fetchUpstream } from "./util/fetcher.js";
import { cached } from "./util/cache.js";
import { TTL } from "./config.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ----- Stub routes to prove each layer works -----

      // Health ping — no upstream call, just prove routing works
      if (path === "/api/ping") {
        return jsonSuccess({
          pong: true,
          timestamp: new Date().toISOString(),
          worker: "v4.0.0-stub",
        });
      }

      // Upstream ping — prove fetcher works
      if (path === "/api/upstream-ping") {
        return cached(
          "upstream:ping",
          TTL.health,
          async () => {
            const start = Date.now();
            const html = await fetchUpstream("/");
            return {
              status: "ok",
              latencyMs: Date.now() - start,
              bytes: html.length,
              hasContent: html.length > 1000,
            };
          },
          ctx
        );
      }

      // Root
      if (path === "/" || path === "") {
        return new Response(
          `AnimeSalt Worker v4.0.0\n\n` +
          `Test endpoints:\n` +
          `  GET /api/ping          → routing check\n` +
          `  GET /api/upstream-ping → fetcher + cache check\n`,
          {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      // Catch-all
      return jsonSuccess({ error: "Not implemented yet", path }, 404);
    } catch (e) {
      return new Response(
        JSON.stringify({ success: false, error: e.message, stack: e.stack }),
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