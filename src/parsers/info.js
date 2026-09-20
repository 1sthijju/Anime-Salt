// ==========================================================================
// Info page parser — series/movie detail pages
// Extracts: title, poster, description, genres, languages, seasons, metadata
// ==========================================================================

const cleanTitle = (t) =>
  String(t || "")
    .replace(/<[^>]+>/g, "")
    .replace(/^Image\s+/i, "")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .trim();

/**
 * Parse a series/movie info page.
 */
export function parseInfoPage(html, id) {
  // Title
  const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

  // Poster — prefer lazy-load, reject data: placeholders
  const posterM =
    html.match(
      /<div[^>]*class="[^"]*poster[^"]*"[^>]*>[\s\S]*?<img[^>]*?\b(?:data-src|src)="([^"]+)"/i
    ) || html.match(/<img[^>]*?\b(?:data-src|src)="(?!data:)([^"]+)"/i);

  // Description
  const descM = html.match(
    /<div[^>]*class="[^"]*(?:description|wp-content|entry-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  );

  // Genres
  const genres = [
    ...html.matchAll(
      /<a[^>]+href="[^"]*\/category\/genre\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi
    ),
  ].map((m) => m[2].trim());

  // Languages
  const languages = [
    ...html.matchAll(
      /<a[^>]+href="[^"]*\/category\/language\/([^"\/]+)[^"]*"[^>]*>([^<]+)<\/a>/gi
    ),
  ].map((m) => m[2].trim());

  // Seasons — extract from <select> or data attributes
  const seasonsRaw = [
    ...html.matchAll(/<option[^>]+value="(\d+)"[^>]*>([\s\S]*?)<\/option>/gi),
  ]
    .map((m) => ({ value: m[1], label: cleanTitle(m[2]) }))
    .filter((s) => /Season\s*\d+/i.test(s.label));

  const seasons = seasonsRaw.map((s) => {
    const num = parseInt(s.label.match(/Season\s*(\d+)/i)[1], 10);
    return { num, title: s.label, value: s.value };
  });

  // Total episodes from season ranges like "Season 1 • 1-23 (23)"
  const totalEpisodes = seasons.reduce((sum, s) => {
    const count = parseInt((s.title.match(/\((\d+)\)/) || [])[1] || 0, 10);
    return sum + count;
  }, 0);

  // Year
  const yearM = html.match(/\b(19[5-9]\d|20[0-2]\d)\b/);

  // Status
  const statusM = html.match(/Status[:\s]*([A-Za-z]+)/i);

  // Runtime
  const runtimeM = html.match(/(\d+)\s*min/i);

  return {
    id,
    title: cleanTitle(titleM ? titleM[1] : id),
    poster: posterM ? posterM[1] : "",
    backdrop: "",
    description: descM ? cleanTitle(descM[1]) : "",
    type: html.includes("/movies/") ? "movie" : "series",
    totalEpisodes,
    year: yearM ? yearM[1] : "",
    status: statusM ? statusM[1] : "",
    seasons,
    genres,
    languages,
    runtime: runtimeM ? runtimeM[1] : "",
    quickPlay: {
      first: seasons[0]
        ? { season: seasons[0].num, episode: 1, slug: `${id}-${seasons[0].num}x1` }
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