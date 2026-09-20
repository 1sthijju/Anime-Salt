// ==========================================================================
// Semaphore-gated upstream fetcher
// Caps concurrent upstream fetches to prevent CPU spikes / 1102 errors
// ==========================================================================

import { UPSTREAM, CHROME_HEADERS } from "../config.js";

// Simple semaphore: max N parallel async tasks
function makeSemaphore(max) {
  let active = 0;
  const queue = [];
  return (fn) =>
    new Promise((resolve, reject) => {
      const run = async () => {
        active++;
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        } finally {
          active--;
          if (queue.length) queue.shift()();
        }
      };
      if (active < max) run();
      else queue.push(run);
    });
}

const gate = makeSemaphore(6);

/**
 * Fetch a path from the upstream proxy with:
 *   - semaphore gating (max 6 parallel)
 *   - per-request timeout
 *   - exponential-backoff retries
 */
export async function fetchUpstream(path, opts = {}) {
  const url = UPSTREAM + path;
  const { timeoutMs = 10000, retries = 2 } = opts;
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await gate(() =>
        fetch(url, {
          headers: CHROME_HEADERS,
          redirect: "follow",
          signal: ctrl.signal,
        })
      );
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr || new Error("Upstream unreachable");
}