// ==========================================================================
// /api/health — health check endpoint
// ==========================================================================

import { UPSTREAM, CHROME_HEADERS } from "../config.js";
import { cached } from "../util/cache.js";
import { TTL } from "../config.js";

export async function handleHealth(ctx) {
  return cached(
    "health",
    TTL.health,
    async () => {
      const start = Date.now();
      let online = false;
      let error = null;
      try {
        const res = await fetch(UPSTREAM + "/", { headers: CHROME_HEADERS });
        online = res.status < 500;
      } catch (e) {
        error = e.message;
      }
      return {
        success: true,
        status: online ? "healthy" : "degraded",
        timestamp: new Date().toISOString(),
        upstream: {
          source: UPSTREAM,
          online,
          latencyMs: Date.now() - start,
          error,
        },
        version: "4.1.0-modular",
      };
    },
    ctx
  );
}