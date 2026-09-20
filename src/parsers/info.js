// ==========================================================================
// Info page parser v5
// description : Overview block → desc class → og:description (spam-filtered)
// year        : JSON-LD → <time> → standalone >YYYY< chip in first 40KB
// poster      : best TMDB width (w500 > w342 > w780 > any)
// quickPlay   : labeled links → max slug → movie fallback {slug:id}
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
  if (!poster) {
    const wrap = html.match(/<div[^>]*class="[^"]*poster[^"]*"[^>]*>[\s\S]*?<img[^>]*?\b(?:data-src|src)="([^"]+)"/i);
    if (wrap && !wrap[1].startsWith("data:")) poster = fixUrl(wrap[1]);
  }

  // ---- description: Overview block first, spam-filtered og last ----
  let description = "";
  const ov = html.match(
    /(?:Overview|Synopsis|Summary|Plot)[\s\S]{0,500}?(<(?:p|div)[^>]*>[\s\S]{40,4000}?<\/(?:p|div)>)/i
  );
  if (ov) description = clean(ov[1]);
  if (!description || isSpamDesc(description)) {
    const dm = html.match(/<div[^>]*class="[^"]*(?:desc|synopsis|summary)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (dm) description = clean(dm[1]);
  }
  if (!description || isSpamDesc(description)) {
    const ogDesc =
      html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i) ||
      html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
    if (ogDesc && !isSpamDesc(clean(ogDesc[1]))) description = clean(ogDesc[1]);
  }
  if (isSpamDesc(description)) description = "";

  // ---- year: JSON-LD → <time> → standalone chip in first 40KB ----
  const ym =
    html.match(/"datePublished"\s*:\s*"(\d{4})/i) ||
    html.match(/<time[^>]*datetime="(\d{4})/i) ||
    html.slice(0, 40000).match(/>(19[5-9]\d|20[0-2]\d)</);
  const year = ym ? ym[1] : "";

  // ---- status: left to handler inference ----
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
  // movie fallback: watch route resolves /movies/<id>/ directly
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