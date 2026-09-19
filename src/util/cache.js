// ==========================================================================
// Stale-while-revalidate cache wrapper
// Uses Cloudflare Cache API + ctx.waitUntil() for background refresh
// ==========================================================================

/**
 * Get a cached value or compute it fresh.
 * On cache hit: return stale, refresh in background (if ctx provided).
 * On cache miss: compute, cache, return.
 *
 * @param {string} key - cache key (will be URL-encoded)
 * @param {number} ttl - max-age in seconds
 * @param {Function} compute - async function returning value to cache
 * @param {object} ctx - Cloudflare request context (has waitUntil)
 * @returns {Promise<Response>} cached JSON response
 */
export async function cached(key, ttl, compute, ctx) {
  const cache = caches.default;
  const url = new URL(`https://__cache/${encodeURIComponent(key)}`);

  // Try cache first
  const hit = await cache.match(url);
  if (hit) {
    // Background refresh: return stale now, refresh later
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(
        (async () => {
          try {
            const fresh = await compute();
            const payload = typeof fresh === "string" ? fresh : JSON.stringify(fresh);
            await cache.put(
              url,
              new Response(payload, {
                headers: cacheHeaders(ttl),
              })
            );
          } catch {
            // Background refresh failure is non-fatal — stale value still served
          }
        })()
      );
    }
    return hit;
  }

  // Cache miss: compute fresh
  const fresh = await compute();
  const payload = typeof fresh === "string" ? fresh : JSON.stringify(fresh);
  const response = new Response(payload, { headers: cacheHeaders(ttl) });

  try {
    await cache.put(url, response.clone());
  } catch {
    // Cache write failure is non-fatal — return the fresh value anyway
  }

  return response;
}

function cacheHeaders(ttl) {
  return {
    "Content-Type": "application/json",
    "Cache-Control": `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}`,
    "Access-Control-Allow-Origin": "*",
  };
}