// ==========================================================================
// Info page parser v4
// type   : canonical/og:url (not string heuristics)
// desc   : og:description → meta description → Overview block
// year   : JSON-LD datePublished → <time datetime> → labeled field
// status : /category/status/<slug>/ link
// latest : labeled "Latest Dub" link → else max episode slug
// ==========================================================================

const clean = (t) =>
  String(t || "")
    .replace(/<[^>]+>/g, "")
    .replace(/^Image\s+/i, "")
    .replace(/&amp;/g, "&").replace(/&#8217;/g, "'").replace(/&#8211;/g, "-")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();

const fixUrl = (u) => (u && u.startsWith("//") ? "https:" + u : u || "");

export function parseInfoPage(html, id, fetchedKind = "series") {
  // ---- title ----
  const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

  // ---- type: canonical / og:url ----
  const canon =
    html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i) ||
    html.match(/<meta[^>]*property="og:url"[^>]*content="([^"]+)"/i);
  let type = fetchedKind;
  if (canon) type = /\/movies?\//i.test(canon[1]) ? "movie" : "series";

  // ---- poster: TMDB preferred, reject site logo ----
  let poster = "";
  const posterWrap = html.match(/<div[^>]*class="[^"]*poster[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (posterWrap) {
    const imgM = posterWrap[1].match(/<img[^>]*?\b(?:data-src|src)="([^"]+)"/i);
    if (imgM) poster = fixUrl(imgM[1]);
  }
  if (!poster || /AnimeSaltLong|logo/i.test(poster)) {
    for (const m of html.matchAll(/<img[^>]*?\b(?:data-src|src)="([^"]+)"/gi)) {
      const img = fixUrl(m[1]);
      if (img.startsWith("data:") || /logo|AnimeSaltLong/i.test(img)) continue;
      if (/tmdb\.org|w500|w342|w780/.test(img)) { poster = img; break; }
    }
  }

  // ---- description: og:description → meta → Overview block → class block ----
  let description = "";
  const ogDesc =
    html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i) ||
    html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
  if (ogDesc) description = clean(ogDesc[1]);
  if (!description) {
    const ov = html.match(/Overview[\s\S]{0,300}?<(?:p|div)[^>]*>([\s\S]{20,3000}?)<\/(?:p|div)>/i);
    if (ov) description = clean(ov[1]);
  }
  if (!description) {
    const dm = html.match(/<div[^>]*class="[^"]*(?:desc|synopsis|summary|entry-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (dm) description = clean(dm[1]);
  }

  // ---- year: JSON-LD → <time datetime> → labeled ----
  const ym =
    html.match(/"datePublished"\s*:\s*"(\d{4})/i) ||
    html.match(/<time[^>]*datetime="(\d{4})/i) ||
    html.match(/(?:Release|Year|Aired|Premiered)[^0-9\n]{0,30}(19[5-9]\d|20[0-2]\d)/i);
  const year = ym ? ym[1] : "";

  // ---- status: /category/status/<slug>/ link → word fallback ----
  let status = "";
  const sm = html.match(/\/category\/status\/([a-z0-9-]+)\/?["']/i);
  if (sm) status = prettify(sm[1]);
  else {
    const sw = html.match(/>\s*(Ongoing|Completed|Released|Airing|Upcoming)\s*</i);
    if (sw) status = sw[1];
  }

  // ---- genres / languages ----
  const genresBlock = html.match(/Genres[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  let genres = genresBlock
    ? [...genresBlock[1].matchAll(/<a[^>]+href="[^"]*\/category\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/gi)].map((m) => m[1].trim())
    : [];
  const langsBlock = html.match(/Languages[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  const languages = langsBlock
    ? [...langsBlock[1].matchAll(/(?:>|\s)([A-Za-z][A-Za-z]+)(?:<|\s{2,}|,)/g)].map((m) => m[1].trim()).filter((l) => l.length > 1 && l.length < 20)
    : [];

  // ---- seasons (javascript:void(0) tabs) ----
  const seasons = [...html.matchAll(/<a[^>]+href="javascript:void\(0\)"[^>]*>([^<]*Season\s*\d+[^<]*)<\/a>/gi)]
    .map((m) => clean(m[1]))
    .map((label) => {
      const numM = label.match(/Season\s*(\d+)/i);
      const countM = label.match(/\((\d+)\)/);
      return numM ? { num: +numM[1], title: label, count: countM ? +countM[1] : 0, value: numM[1] } : null;
    })
    .filter(Boolean);

  // ---- episode slugs on page ----
  const epLinks = [...html.matchAll(/href="https?:\/\/animesalt\.cx\/episode\/([^"\/?#]+)\/?"/gi)].map((m) => m[1]);
  const episodeSlugs = [...new Set(epLinks)];

  // ---- quickPlay: labeled links → fallback compute ----
  let firstSlug = null, latestSlug = null;
  const linkRe = /href="https?:\/\/animesalt\.cx\/episode\/([^"\/?#]+)\/?"[^>]*>([\s\S]{0,80}?)<\/a>/g;
  let lm;
  while ((lm = linkRe.exec(html)) !== null) {
    const label = clean(lm[2]);
    if (/First/i.test(label) && !firstSlug) firstSlug = lm[1];
    if (/Latest\s*Dub/i.test(label) && !latestSlug) latestSlug = lm[1];
  }
  if (!firstSlug && episodeSlugs.length) firstSlug = episodeSlugs[0];
  if (!latestSlug && episodeSlugs.length) {
    // max by season then num
    latestSlug = episodeSlugs.slice().sort((a, b) => {
      const pa = a.match(/(\d+)x(\d+)$/), pb = b.match(/(\d+)x(\d+)$/);
      if (!pa || !pb) return 0;
      return (+pa[1] - +pb[1]) || (+pa[2] - +pb[2]);
    }).pop();
  }

  return {
    id,
    title: titleM ? clean(titleM[1]) : id,
    poster,
    backdrop: "",
    description: description.slice(0, 1200),
    type,
    totalEpisodes: seasons.reduce((s, x) => s + (x.count || 0), 0),
    year,
    status,
    seasons,
    genres: genres.slice(0, 10),
    languages: [...new Set(languages)].slice(0, 10),
    runtime: (html.match(/(\d+)\s*min/i) || [])[1] || "",
    episodeSlugs,
    quickPlay: {
      first: firstSlug ? { slug: firstSlug } : null,
      latestDub: latestSlug ? { slug: latestSlug } : null,
      latestSub: null,
    },
  };
}

function prettify(s) {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}