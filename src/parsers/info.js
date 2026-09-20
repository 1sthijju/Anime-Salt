// ==========================================================================
// Info page parser v6
// description : paragraph/div AFTER "Overview" heading
// year        : metadata section year, exclude footer
// ==========================================================================

const clean = (t) =>
  String(t || "")
    .replace(/<[^>]+>/g, "")
    .replace(/^Image\s+/i, "")
    .replace(/&amp;/g, "&").replace(/&#8217;/g, "'").replace(/&#8211;/g, "-")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const fixUrl = (u) => (u && u.startsWith("//") ? "https:" + u : u || "");

const isSpamDesc = (d) => /Download\s*\/\s*Watch Online|480p,\s*720p|Hindi Dubbed/i.test(d);

export function parseInfoPage(html, id, fetchedKind = "series") {
  // ---- title ----
  const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

  // ---- type: canonical / og:url ----
  const canon =
    html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i) ||
    html.match(/<meta[^>]*property="og:url"[^>]*content="([^"]+)"/i);
  let type = fetchedKind;
  if (canon) type = /\/movies?\//i.test(canon[1]) ? "movie" : "series";

  // ---- poster: best TMDB width ----
  let poster = "";
  const tmdbImgs = [...html.matchAll(/<img[^>]*?\b(?:data-src|src)="(\/\/image\.tmdb\.org[^"]+|https?:\/\/image\.tmdb\.org[^"]+)"/gi)]
    .map((m) => fixUrl(m[1]))
    .filter((u) => !u.startsWith("data:"));
  for (const w of ["w500", "w342", "w780", "w1280", "w185"]) {
    const hit = tmdbImgs.find((u) => u.includes(`/t/p/${w}/`));
    if (hit) { poster = hit; break; }
  }

  // ---- description: find Overview heading, grab NEXT paragraph/div ----
  let description = "";
  
  // Pattern 1: Look for "Overview" or "Synopsis" heading, then grab next <p> or <div>
  const overviewM = html.match(/(?:Overview|Synopsis|Summary|Plot)\s*<\/(?:h[2-4]|div|span)>[\s\S]{0,200}?(<(?:p|div)[^>]*>([\s\S]{40,5000}?)<\/(?:p|div)>)/i);
  if (overviewM) description = clean(overviewM[2]);
  
  // Pattern 2: class-based description
  if (!description || description.length < 30) {
    const dm = html.match(/<div[^>]*class="[^"]*(?:desc|synopsis|summary|content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (dm) {
      const desc = clean(dm[1]);
      if (desc.length > 30 && !isSpamDesc(desc)) description = desc;
    }
  }
  
  // Pattern 3: og:description (filter spam)
  if (!description || description.length < 30) {
    const ogDesc =
      html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i) ||
      html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
    if (ogDesc) {
      const desc = clean(ogDesc[1]);
      if (desc.length > 30 && !isSpamDesc(desc)) description = desc;
    }
  }

  // ---- year: find in metadata section, exclude footer ----
  let year = "";
  
  // Strategy: search first 30KB (before footer), look for year near "Release" or in metadata div
  const headerSection = html.slice(0, 30000);
  
  // Pattern 1: "Release: 2022" or "Year: 2016"
  const releaseM = headerSection.match(/(?:Release|Year|Aired|Premiered|Released)[^0-9\n]{0,50}(19[5-9]\d|20[0-2]\d)/i);
  if (releaseM) year = releaseM[1];
  
  // Pattern 2: <time datetime="2022">
  if (!year) {
    const timeM = headerSection.match(/<time[^>]*datetime="(\d{4})/i);
    if (timeM) year = timeM[1];
  }
  
  // Pattern 3: JSON-LD datePublished
  if (!year) {
    const jsonM = html.match(/"datePublished"\s*:\s*"(\d{4})/i);
    if (jsonM) year = jsonM[1];
  }
  
  // Pattern 4: standalone year in metadata section (not footer)
  if (!year) {
    // Look for year after "Genres" or "Languages" but before footer
    const metaSection = html.slice(0, 25000);
    const yearChip = metaSection.match(/(?:Genres|Languages|Status)[\s\S]{0,2000}>(19[5-9]\d|20[0-2]\d)</);
    if (yearChip) year = yearChip[1];
  }

  // ---- status ----
  let status = "";
  const sm = html.match(/\/category\/status\/([a-z0-9-]+)\/?["']/i);
  if (sm) status = sm[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // ---- genres / languages ----
  const genresBlock = html.match(/Genres[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  const genres = genresBlock
    ? [...genresBlock[1].matchAll(/<a[^>]+href="[^"]*\/category\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/gi)].map((m) => m[1].trim())
    : [];
  const langsBlock = html.match(/Languages[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  const languages = langsBlock
    ? [...langsBlock[1].matchAll(/(?:>|\s)([A-Za-z][A-Za-z]+)(?:<|\s{2,}|,)/g)].map((m) => m[1].trim()).filter((l) => l.length > 1 && l.length < 20)
    : [];

  // ---- seasons ----
  const seasons = [...html.matchAll(/<a[^>]+href="javascript:void\(0\)"[^>]*>([^<]*Season\s*\d+[^<]*)<\/a>/gi)]
    .map((m) => clean(m[1]))
    .map((label) => {
      const numM = label.match(/Season\s*(\d+)/i);
      const countM = label.match(/\((\d+)\)/);
      return numM ? { num: +numM[1], title: label, count: countM ? +countM[1] : 0, value: numM[1] } : null;
    })
    .filter(Boolean);

  // ---- episode slugs ----
  const epLinks = [...html.matchAll(/href="https?:\/\/animesalt\.cx\/episode\/([^"\/?#]+)\/?"/gi)].map((m) => m[1]);
  const episodeSlugs = [...new Set(epLinks)];

  // ---- quickPlay ----
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
    latestSlug = episodeSlugs.slice().sort((a, b) => {
      const pa = a.match(/(\d+)x(\d+)$/), pb = b.match(/(\d+)x(\d+)$/);
      if (!pa || !pb) return 0;
      return (+pa[1] - +pb[1]) || (+pa[2] - +pb[2]);
    }).pop();
  }
  if (type === "movie" && !firstSlug) firstSlug = id;

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