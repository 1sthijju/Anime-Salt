export interface Anime {
  id: string;
  title: string;
  image: string;
  type: 'series' | 'movie';
  url: string;
}

export interface PopularItem extends Anime {
  rank: number;
}

export interface AnimeInfo {
  id: string;
  title: string;
  poster: string;
  description: string;
  type: 'series' | 'movies';
  totalEpisodes: number;
  year?: number;
  status?: string;
  seasons: { num: number; title: string; value?: string }[];
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

export interface MultiLang {
  language: string;
  link: string;
}

export interface Server {
  index: number;
  serverName: string;
  embedUrl: string | null;
  isMultiLang: boolean;
  languages: MultiLang[];
}

export interface Quality {
  resolution: string;
  size?: number;
  url: string;
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
  qualities?: Quality[];
  subtitles?: Subtitle[];
  embedUrl?: string;
  isIframe?: boolean;
  serverIndex: number;
  selectedLanguage?: string | null;
  referer?: string;
  proxied_url?: string | null;
  audio_languages?: AudioLanguage[];
  subtitle_languages?: AudioLanguage[];
  selected_audio?: string | null;
}

export interface ApiResponse<T> {
  success: boolean;
  error?: string;
  data?: T;
  page?: number;
}