import type {
  AnimeInfo, CardItem, DiscoverData, EpisodeList, HomeData,
  RankedItem, Server, StreamData, TaxonomyItem,
} from './types';

export const API_BASE =
  import.meta.env.VITE_API_URL || 'https://anime-salt.abdullahdaniyal.workers.dev';

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Unknown API error');
  return json.data as T;
}

export const api = {
  // Home & feeds
  home: () => request<HomeData>('/api/home'),
  latest: () => request<CardItem[]>('/api/latest-episodes'),
  freshDrops: (page = 1) => request<CardItem[]>(`/api/fresh-drops?page=${page}`),

  // Charts
  popular: (type?: 'series' | 'movie') =>
    request<RankedItem[]>(`/api/popular${type ? `?type=${type}` : ''}`),
  popularSeries: () => request<RankedItem[]>('/api/popular/series'),
  popularFilms: () => request<RankedItem[]>('/api/popular/films'),

  // Catalogs
  browse: (kind: 'series' | 'movies' | 'anime' | 'cartoon', page = 1) =>
    request<CardItem[]>(`/api/${kind}?page=${page}`),
  ongoing: (page = 1) => request<CardItem[]>(`/api/ongoing?page=${page}`),
  completed: (page = 1) => request<CardItem[]>(`/api/completed?page=${page}`),

  // Taxonomy
  genres: () => request<TaxonomyItem[]>('/api/genres'),
  languages: () => request<TaxonomyItem[]>('/api/languages'),
  countries: () => request<TaxonomyItem[]>('/api/countries'),
  discover: () => request<DiscoverData>('/api/discover'),
  genre: (slug: string, page = 1) =>
    request<CardItem[]>(`/api/genre/${encodeURIComponent(slug)}?page=${page}`),
  language: (slug: string, page = 1) =>
    request<CardItem[]>(`/api/language/${encodeURIComponent(slug)}?page=${page}`),
  year: (year: number, page = 1) =>
    request<CardItem[]>(`/api/year/${year}?page=${page}`),

  // Search & detail
  search: (q: string, page = 1) =>
    request<CardItem[]>(`/api/search?keyword=${encodeURIComponent(q)}&page=${page}`),
  info: (id: string) => request<AnimeInfo>(`/api/info?id=${encodeURIComponent(id)}`),
  episodes: (id: string, season?: number) =>
    request<EpisodeList>(
      `/api/episodes/${encodeURIComponent(id)}${season != null ? `?season=${season}` : ''}`
    ),

  // Playback
  servers: (ep: string) => request<Server[]>(`/api/servers?ep=${encodeURIComponent(ep)}`),
  stream: (ep: string, server = 0, lang?: string, audio?: string) =>
    request<StreamData>(
      `/api/stream?ep=${encodeURIComponent(ep)}&server=${server}` +
        `${lang ? `&lang=${encodeURIComponent(lang)}` : ''}` +
        `${audio ? `&audio=${encodeURIComponent(audio)}` : ''}`
    ),

  // Misc
  random: () => request<CardItem>('/api/random'),
};