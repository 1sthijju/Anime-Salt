// ==========================================================================
// Info page parser v3 — TMDB poster + javascript:void(0) season tabs
// ==========================================================================

const clean = (t) =>
  String(t || "")
    .replace(/<[^>]+>/g, "")
    .replace(/^Image\s+/i, "")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&nbsp;/g, " ")
    .trim();

const fixUrl = (u) => (u && u.startsWith("//") ? "https:" + u : u || "");

/**
 * Parse a series/movie info page.
 * - Poster: prefers TMDB image, rejects site logo
 * - Seasons: from javascript:void(0) tabs with "Season N • X-Y (Z)"
 * - Genres/Languages: from labeled blocks
 */
export function parseInfoPage(html, id) {
  const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

  // Poster — prefer TMDB, reject site logo
  let poster = "";
  const posterWrap = html.match(
    /<div[^>]*class="[^"]*poster[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  );
  if (posterWrap) {
    const imgM = posterWrap[1].match(
      /<img[^>]*?\b(?:data-src|src)="([^"]+)"/i
    );
    if (imgM) poster = fixUrl(imgM[1]);
  }
  // Fallback: first TMDB image
  if (!poster || /AnimeSaltLong|logo/i.test(poster)) {
    const allImgs = html.matchAll(
      /<img[^>]*?\b(?:data-src|src)="([^"]+)"/gi
    );
    for (const m of allImgs) {
      const img = fixUrl(m[1]);
      if (img.startsWith("data:")) continue;
      if (/logo|AnimeSaltLong/i.test(img)) continue;
      if (/tmdb\.org|w500|w342|w780/.test(img)) {
        poster = img;
        break;
      }
    }
  }

  const descM = html.match(
    /<div[^>]*class="[^"]*(?:description|wp-content|entry-content|synopsis)[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  );

  // Genres — as links or plain text block
  const genresBlock = html.match(
    /Genres[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i
  );
  let genres = [];
  if (genresBlock) {
    genres = [
      ...genresBlock[1].matchAll(
        /<a[^>]+href="[^"]*\/category\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/gi
      ),
    ].map((m) => m[1].trim());
    if (!genres.length) {
      genres = genresBlock[1]
        .match(/(?:>|\s)([A-Za-z][A-Za-z\s]{1,28}?)(?:<|\s{2,}|,)/g)
        ?.map((s) => s.replace(/^[>\s,]+/, "").trim())
        .filter((g) => g && g.length > 1 && g.length < 30) || [];
    }
  }

  // Languages
  const langsBlock = html.match(
    /Languages[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i
  );
  const languages = langsBlock
    ? [
        ...langsBlock[1].matchAll(
          /(?:>|\s)([A-Za-z][A-Za-z]+)(?:<|\s{2,}|,)/g
        ),
      ]
        .map((m) => m[1].trim())
        .filter((l) => l.length > 1 && l.length < 20)
    : [];

  // Seasons — javascript:void(0) tabs: "Season 1 • 1-25 (25)"
  const seasonTabs = [
    ...html.matchAll(
      /<a[^>]+href="javascript:void\(0\)"[^>]*>([^<]*Season\s*\d+[^<]*)<\/a>/gi
    ),
  ].map((m) => clean(m[1]));

  const seasons = seasonTabs
    .map((label) => {
      const numM = label.match(/Season\s*(\d+)/i);
      const countM = label.match(/\((\d+)\)/);
      return numM
        ? {
            num: parseInt(numM[1], 10),
            title: label,
            count: countM ? parseInt(countM[1], 10) : 0,
            value: numM[1],
          }
        : null;
    })
    .filter(Boolean);

  const totalEpisodes = seasons.reduce((sum, s) => sum + (s.count || 0), 0);

  // Episode slugs on page (currently visible season)
  const epLinks = [
    ...html.matchAll(
      /href="https?:\/\/animesalt\.cx\/episode\/([^"\/?#]+)\/?"/gi
    ),
  ].map((m) => m[1]);
  const episodeSlugs = [...new Set(epLinks)];

  return {
    id,
    title: titleM ? clean(titleM[1]) : id,
    poster,
    backdrop: "",
    description: descM ? clean(descM[1]).slice(0, 1000) : "",
    type: html.toLowerCase().includes("/movies/") ? "movie" : "series",
    totalEpisodes,
    year: (html.match(/\b(19[5-9]\d|20[0-2]\d)\b/) || [])[1] || "",
    status: (html.match(/Status[:\s]*([A-Za-z]+)/i) || [])[1] || "",
    seasons,
    genres: genres.slice(0, 10),
    languages: [...new Set(languages)].slice(0, 10),
    runtime: (html.match(/(\d+)\s*min/i) || [])[1] || "",
    episodeSlugs,
    quickPlay: {
      first: seasons[0]
        ? {
            season: seasons[0].num,
            episode: 1,
            slug: `${id}-${seasons[0].num}x1`,
          }
        : null,
      latestDub: seasons.length
        ? {
            season: seasons[seasons.length - 1].num,
            episode: 1,
            slug: `${id}-${seasons[seasons.length - 1].num}x1`,
          }
        : null,
      latestSub: null,
    },
  };
}