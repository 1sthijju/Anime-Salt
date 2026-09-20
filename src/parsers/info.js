// ==========================================================================
// Info page parser v10
// - Year: anchored to metadata labels, excludes footer years (2000/2025/2026/2027)
// - Backdrop: CSS background-image search
// - Episodes: data-title attribute first, fallback to generic
// ==========================================================================

const clean = (t) =>
  String(t || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/^Image\s+/i, "")
    .replace(/&amp;/g, "&").replace(/&#8217;/g, "'").replace(/&#8211;/g, "-")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const stripLeadingFragments = (t) =>
  t.replace(/^(?:\/?p>|<\/?[a-z][^>]*>|[\s\n\r\/<>]+)/i, "").trim();

const fixUrl = (u) => (u && u.startsWith("//") ? "https:" + u : u || "");

const isSpamDesc = (d) =>
  /Download\s*\/\s*Watch Online|480p,\s*720p|Hindi Dubbed|Watch Online \d/i.test(d);

const isNonEpisodeTitle = (t) =>
  /^(?:Comments?|Reviews?|Share|Related|Recommendations?|Trailer|Watch Now|Download)/i.test(t);

const EXCLUDED_YEARS = new Set(["2000", "2025", "2026", "2027"]);

export function parseInfoPage(html, id, fetchedKind = "series") {
  // ---------------- title ----------------
  const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

  // ---------------- type ----------------
  const canon =
    html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i) ||
    html.match(/<meta[^>]*property="og:url"[^>]*content="([^"]+)"/i);
  let type = fetchedKind;
  if (canon) type = /\/movies?\//i.test(canon[1]) ? "movie" : "series";

  // ---------------- poster (best TMDB width) ----------------
  let poster = "";
  const tmdbImgs = [...html.matchAll(/<img[^>]*?\b(?:data-src|src)="(\/\/image\.tmdb\.org[^"]+|https?:\/\/image\.tmdb\.org[^"]+)"/gi)]
    .map((m) => fixUrl(m[1]))
    .filter((u) => !u.startsWith("data:"));
  for (const w of ["w500", "w342", "w780", "w1280", "w185"]) {
    const hit = tmdbImgs.find((u) => u.includes(`/t/p/${w}/`));
    if (hit) { poster = hit; break; }
  }

  // ---------------- backdrop (wide art in CSS background) ----------------
  let backdrop = "";
  const bgM = html.match(/style="[^"]*background(?:-image)?\s*:\s*url\(['"]?(\/\/image\.tmdb\.org[^'")]+|https?:\/\/image\.tmdb\.org[^'")]+)/i);
  if (bgM) backdrop = fixUrl(bgM[1]);
  if (!backdrop && poster) {
    for (const img of tmdbImgs) {
      if (img === poster) continue;
      if (/w(?:780|1280|original)\//.test(img)) { backdrop = img; break; }
    }
  }

  // ---------------- description ----------------
  let description = "";
  const ovIdx = html.search(/>\s*Overview\s*</i);
  if (ovIdx !== -1) {
    let seg = html.slice(ovIdx);
    const rm = seg.indexOf("Read More");
    const gn = seg.indexOf(">Genres<");
    let cut = seg.length;
    if (rm !== -1) cut = Math.min(cut, rm);
    if (gn !== -1) cut = Math.min(cut, gn);
    seg = seg.slice(0, Math.min(cut, 8000)).replace(/^>\s*Overview\s*</i, "");
    let text = stripLeadingFragments(clean(seg));
    if (text.length > 40 && !isSpamDesc(text)) description = text;
  }
  if (!description) {
    const dm = html.match(/<div[^>]*class="[^"]*(?:desc|synopsis|summary)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (dm) {
      const t = stripLeadingFragments(clean(dm[1]));
      if (t.length > 40 && !isSpamDesc(t)) description = t;
    }
  }
  if (!description) {
    const ogDesc =
      html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i) ||
      html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
    if (ogDesc) {
      const t = stripLeadingFragments(clean(ogDesc[1]));
      if (t.length > 40 && !isSpamDesc(t)) description = t;
    }
  }

  // ---------------- year: anchored to metadata labels, excludes footer ----------------
  let year = "";
  const header = html.slice(0, 15000);
  const labelPatterns = [
    /(?:Episodes?|Seasons?|Runtime|Type|Status)\b[^0-9]{0,300}?(19[5-9]\d|20[0-2]\d)/gi,
    /(19[5-9]\d|20[0-2]\d)[^0-9]{0,300}?\b(?:Episodes?|Seasons?)/gi,
  ];
  for (const pat of labelPatterns) {
    const m = pat.exec(header);
    if (m && !EXCLUDED_YEARS.has(m[1])) { year = m[1]; break; }
  }
  if (!year) {
    const allYears = [...header.matchAll(/\b(19[5-9]\d|20[0-2]\d)\b/g)]
      .map((m) => m[1])
      .filter((y) => !EXCLUDED_YEARS.has(y));
    year = allYears[0] || "";
  }
  if (!year) {
    const ym = html.match(/"datePublished"\s*:\s*"(19[5-9]\d|20[0-2]\d)/i);
    if (ym && !EXCLUDED_YEARS.has(ym[1])) year = ym[1];
  }

  // ---------------- status ----------------
  let status = "";
  const sm = html.match(/\/category\/status\/([a-z0-9-]+)\/?["']/i);
  if (sm) status = sm[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // ---------------- genres / languages ----------------
  const genresBlock = html.match(/Genres[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  const genres = genresBlock
    ? [...genresBlock[1].matchAll(/<a[^>]+href="[^"]*\/category\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/gi)].map((m) => m[1].trim())
    : [];
  const langsBlock = html.match(/Languages[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  const languages = langsBlock
    ? [...langsBlock[1].matchAll(/(?:>|\s)([A-Za-z][A-Za-z]+)(?:<|\s{2,}|,)/g)]
        .map((m) => m[1].trim())
        .filter((l) => l.length > 1 && l.length < 20)
    : [];

  // ---------------- seasons ----------------
  const seasons = [...html.matchAll(
    /<(?:a|button)[^>]*(?:href="javascript:void\(0\)"|data-season)[^>]*>([^<]*Season\s*\d+[^<]*)<\/(?:a|button)>/gi
  )]
    .map((m) => clean(m[1]))
    .map((label) => {
      const numM = label.match(/Season\s*(\d+)/i);
      const countM = label.match(/\((\d+)\)/);
      return numM
        ? { num: +numM[1], title: label, count: countM ? +countM[1] : 0, value: numM[1] }
        : null;
    })
    .filter(Boolean);

  // ---------------- episodes ----------------
  const episodesPreview = [];
  const epRe = /<a[^>]+href="https?:\/\/animesalt\.cx\/episode\/([^"\/?#]+)\/?"([^>]*)>([\s\S]*?)<\/a>/g;
  let em;
  while ((em = epRe.exec(html)) !== null) {
    const slug = em[1];
    const attrs = em[2];
    if (episodesPreview.some((e) => e.slug === slug)) continue;
    const chunk = em[3];
    
    let title = "";
    const dataTitle = attrs.match(/\bdata-(?:title|ep-?title)="([^"]+)"/i);
    if (dataTitle) {
      const candidate = clean(dataTitle[1]);
      if (!isNonEpisodeTitle(candidate)) title = candidate;
    }
    if (!title) {
      const tM =
        chunk.match(/class="[^"]*(?:ep-?title|episode-?title|title|name)[^"]*"[^>]*>([^<]{2,100})</i) ||
        chunk.match(/<(?:h[34]|div|span)[^>]*class="[^"]*title[^"]*"[^>]*>([^<]{2,100})</i) ||
        chunk.match(/\balt="([^"]{2,100})"/i);
      if (tM) {
        const candidate = clean(tM[1]);
        if (!isNonEpisodeTitle(candidate)) title = candidate;
      }
    }
    if (isNonEpisodeTitle(title)) continue;
    
    const sxe = slug.match(/(\d+)x(\d+)$/);
    episodesPreview.push({
      slug,
      season: sxe ? +sxe[1] : 1,
      num: sxe ? +sxe[2] : 0,
      title: title || `Episode ${sxe ? sxe[2] : ""}`,
      image: (() => {
        const iM = chunk.match(/<img[^>]*?\b(?:data-src|src)="(?!data:)([^"]+)"/i);
        return iM ? fixUrl(iM[1]) : null;
      })(),
    });
  }
  const episodeSlugs = episodesPreview.map((e) => e.slug);

  // ---------------- quickPlay ----------------
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
    backdrop,
    description: description.slice(0, 1500),
    type,
    totalEpisodes: seasons.reduce((s, x) => s + (x.count || 0), 0),
    year,
    status,
    seasons,
    genres: genres.slice(0, 10),
    languages: [...new Set(languages)].slice(0, 10),
    runtime: (html.match(/(\d+)\s*min/i) || [])[1] || "",
    episodeSlugs,
    episodesPreview,
    quickPlay: {
      first: firstSlug ? { slug: firstSlug } : null,
      latestDub: latestSlug ? { slug: latestSlug } : null,
      latestSub: null,
    },
  };
}