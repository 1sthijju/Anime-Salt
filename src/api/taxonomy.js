// ==========================================================================
// Taxonomy v2 — discover via WP sitemap, fallback to candidate index pages
// ==========================================================================

import { fetchUpstream } from "../util/fetcher.js";
import { cached } from "../util/cache.js";
import { parseCatalogItems } from "../parsers/cards.js";
import { TTL } from "../config.js";

const KINDS = ["genre", "language", "country", "type", "year", "network", "franchise", "status"];
export const TAXONOMY_KINDS = KINDS;

const prettify = (slug) =>
  slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Parse /category/<kind>/<slug>/ anchor links from any HTML */
function parseTaxonomyLinks(html) {
  const out = {};
  for (const kind of KINDS) {
    const re = new RegExp(
      `<a[^>]+href="[^"]*\\/category\\/${kind}\\/([^"\\/]+)\\/?"[^>]*>([^<]+)<\\/a>`,
      "gi"
    );
    const seen = new Set();
    const list = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      const name = m[2].trim();
      if (!name || name.length > 40 || seen.has(m[1])) continue;
      seen.add(m[1]);
      list.push({ slug: m[1], name });
    }
    out[kind] = list;
  }
  return out;
}

/** Source 1: WordPress sitemap (lists every category URL) */
async function discoverFromSitemap() {
  const idx = await fetchUpstream("/wp-sitemap.xml");
  const locs = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const taxMaps = locs.filter((u) => /taxonomy|category/i.test(u));
  if (!taxMaps.length) throw new Error("no taxonomy sitemap");

  const found = Object.fromEntries(KINDS.map((k) => [k, []]));
  for (const abs of taxMaps.slice(0, 4)) {
    const path = abs.replace(/^https?:\/\/[^/]+/, "");
    let xml;
    try { xml = await fetchUpstream(path); } catch { continue; }
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const cm = m[1].trim().match(/\/category\/([a-z-]+)\/([^/]+)\/?$/i);
      if (!cm) continue;
      const kind = cm[1].toLowerCase();
      if (!KINDS.includes(kind)) continue;
      if (found[kind].some((x) => x.slug === cm[2])) continue;
      found[kind].push({ slug: cm[2], name: prettify(cm[2]) });
    }
  }
  const total = KINDS.reduce((s, k) => s + found[k].length, 0);
  if (!total) throw new Error("sitemap had no category urls");
  return found;
}

/** Source 2: candidate index pages that may contain category menus */
async function discoverFromPages() {
  const candidates = ["/genres/", "/genre/", "/category/genre/", "/filter/", "/advanced-search/", "/anime/", "/"];
  const merged = Object.fromEntries(KINDS.map((k) => [k, []]));
  for (const p of candidates) {
    let html;
    try { html = await fetchUpstream(p); } catch { continue; }
    const t = parseTaxonomyLinks(html);
    for (const kind of KINDS) {
      for (const item of t[kind]) {
        if (!merged[kind].some((x) => x.slug === item.slug)) merged[kind].push(item);
      }
    }
  }
  const total = KINDS.reduce((s, k) => s + merged[k].length, 0);
  if (!total) throw new Error("no taxonomy links on candidate pages");
  return merged;
}

async function discoverTaxonomy() {
  try { return await discoverFromSitemap(); } catch {}
  try { return await discoverFromPages(); } catch {}
  throw new Error("taxonomy sources unavailable");
}

export async function handleDiscover(ctx) {
  return cached("discover:v2", TTL.taxonomy, async () => {
    const d = await discoverTaxonomy();
    return {
      ...d,
      topLevel: [],
      counts: Object.fromEntries(KINDS.map((k) => [k, d[k].length])),
    };
  }, ctx);
}

export async function handleGenreList(ctx) {
  return cached("genres:v2", TTL.taxonomy, async () => (await discoverTaxonomy()).genres, ctx);
}

/** /api/genre/<slug> etc. — paginated results */
export async function handleTaxonomy(kind, slug, ctx, url) {
  const page = Number(url.searchParams.get("page") || 1);
  return cached(
    `tax:${kind}:${slug}:p${page}`,
    TTL.taxonomy,
    async () => {
      try {
        const html = await fetchUpstream(
          `/category/${kind}/${slug}/${page > 1 ? `page/${page}/` : ""}`
        );
        return { page, [kind]: slug, data: parseCatalogItems(html) };
      } catch (e) {
        return { page, [kind]: slug, data: [], error: e.message };
      }
    },
    ctx
  );
}