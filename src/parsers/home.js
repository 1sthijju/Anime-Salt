// ==========================================================================
// Homepage section parser v2
// - Heading match tolerates h1-h6/div/span + inner icon tags
// - Blocks sliced heading→heading so cards never leak across rows
// - inspectHomeSections() reports found/missing per section for debugging
// ==========================================================================

import { parseCatalogItems, parseMostWatched } from "./cards.js";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const HOME_SECTION_TITLES = [
  ["fresh-drops",    "Fresh Drops"],
  ["on-air",         "On-Air Series"],
  ["new-arrivals",   "New Anime Arrivals"],
  ["cartoon-series", "Just In: Cartoon Series"],
  ["anime-movies",   -movies",  "Latest Anime Movies"].map ? null : null, // placeholder removed below
].filter(Boolean);

// (clean list)
export const SECTIONS = [
  ["fresh-drops",    "Fresh Drops"],
  ["on-air",         "On-Air Series"],
  ["new-arrivals",   "New Anime Arrivals"],
  ["cartoon-series", "Just In: Cartoon Series"],
  ["anime-movies",   "Latest Anime Movies"],
  ["cartoon-films",  "Fresh Cartoon Films"],
];

/** tolerant heading finder: <h3|div|span …>(icons…)?Title */
const headingPos = (html, title) => {
  const re = new RegExp(
    "<(?:h[1-6]|div|span|p)[^>]*>(?:\\s*<[^>]+>)*\\s*" + esc(title),
    "i"
  );
  const m = re.exec(html);
  return m ? m.index : -1;
};

export function parseHomeSections(html) {
  const mw = parseMostWatched(html);
  const out = {
    "most-watched-series": mw.series,
    "most-watched-films": mw.films,
  };

  const marks = [];
  for (const [key, title] of SECTIONS) {
    const pos = headingPos(html, title);
    if (pos !== -1) marks.push({ key, pos });
  }
  marks.sort((a, b) => a.pos - b.pos);

  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].pos : html.length;
    out[mk.key] = parseCatalogItems(html.slice(mk.pos, end));
  });

  out["latest"] = out["new-arrivals"] || parseCatalogItems(html).slice(0, 24);
  return out;
}

/** network logo strip → [{slug,name,image}] */
export function parseNetworkStrip(html) {
  const seen = new Set();
  const out = [];
  const re = /<a[^>]+href="[^"]*\/category\/network\/([^"\/]+)\/?"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    const img = m[2].match(/<img[^>]*?\b(?:data-src|src)="([^"]+)"/i);
    const alt = m[2].match(/\balt="([^"]+)"/i);
    out.push({
      slug,
      name: alt ? alt[1].trim() : slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      image: img ? (img[1].startsWith("//") ? "https:" + img[1] : img[1]) : "",
    });
    if (out.length >= 12) break;
  }
  return out;
}

/** "Navigate A to Z" → [{letter,url}] */
export function parseAzIndex(html) {
  const pos = headingPos(html, "Navigate A to Z");
  if (pos === -1) return [];
  const block = html.slice(pos, pos + 8000);
  const out = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>\s*([#A-Z])\s*<\/a>/g;
  let m;
  while ((m = re.exec(block)) !== null) out.push({ letter: m[2], url: m[1] });
  return out;
}

/** debug report: heading found? items parsed? first title? */
export function inspectHomeSections(html) {
  const map = parseHomeSections(html);
  const all = [
    ["most-watched-series", "Most-Watched Series"],
    ["most-watched-films", "Most-Watched Films"],
    ...SECTIONS,
    ["az", "Navigate A to Z"],
  ];
  const report = {};
  for (const [key, title] of all) {
    const items = Array.isArray(map[key]) ? map[key] : [];
    report[key] = {
      headingFound: headingPos(html, title) !== -1,
      items: items.length,
      firstTitle: items[0] ? items[0].title : null,
    };
  }
  report.networks = { items: parseNetworkStrip(html).length };
  return report;
}