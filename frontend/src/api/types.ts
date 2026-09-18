export interface CardItem {
  id: string;
  title: string;
  image: string;
  type: 'series' | 'movie';
  url: string;
}

export interface RankedItem extends CardItem {
  rank: number;
}

export interface HomeData {
  latest: CardItem[];
  mostWatchedSeries: RankedItem[];
  mostWatchedFilms: RankedItem[];
  freshDrops: CardItem[];
  onAirSeries: CardItem[];
  newAnimeArrivals: CardItem[];
  cartoonSeries: CardItem[];
  animeMovies: CardItem[];
  cartoonFilms: CardItem[];
  popular: RankedItem[];
  popularSeries: RankedItem[];
  popularFilms: RankedItem[];
  ongoing: CardItem[];
  completed: CardItem[];
  movies: CardItem[];
}

export interface TaxonomyItem {
  slug: string;
  name: string;
  url: string;
}

export interface DiscoverData {
  genres: TaxonomyItem[];
  languages: TaxonomyItem[];
  countries: TaxonomyItem[];
  types: string[];
  statuses: string[];
}

export interface AnimeInfo {
  id: string;
  title: string;
  poster: string;
  description: string;
  type: 'series' | 'movies';
  totalEpisodes: number;
  year: number | null;
  status: string;
  seasons: { num: number; title: string }[];
  genres: string[];
  languages: string[];
}

export interface Episode {
  num: number;
  season: number;
  title: string;
  slug: string;
  url: string;
}

export interface EpisodeList {
  animeId: string;
  availableSeasons: number[];
  totalEpisodes: number;
  groupedEpisodes: Record<string, Episode[]>;
}

export interface Server {
  index: number;
  serverName: string;
  embedUrl: string | null;
  isMultiLang: boolean;
  languages: { language: string; link: string }[];
}

export interface Subtitle {
  label: string;
  url: string;
}

export interface AudioLanguage {
  code: string;
  name: string;
}

export interface StreamData {
  host?: string;
  source_type?: 'hls' | 'mp4';
  direct_hls?: string;
  qualities?: { resolution: string; size?: number; url: string }[];
  subtitles?: Subtitle[];
  proxied_url?: string | null;
  audio_languages?: AudioLanguage[];
  selected_audio?: string | null;
  serverIndex: number;
  selectedLanguage?: string | null;
  isIframe?: boolean;
  embedUrl?: string;
  referer?: string;
}