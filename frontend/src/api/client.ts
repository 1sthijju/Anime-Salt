import type {
  Anime,
  PopularItem,
  AnimeInfo,
  EpisodeList,
  Server,
  StreamData,
  ApiResponse,
} from './types';

const API_BASE = import.meta.env.VITE_API_URL ||
  'https://anime-salt.abdullahdaniyal.workers.dev';

async function request<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json: ApiResponse<T> = await res.json();
  if (!json.success) throw new Error(json.error || 'Unknown API error');
  return json.data as T;
}

export const api = {
  search: (q: string, page = 1) =>
    request<Anime[]>(`/api/search?keyword=${encodeURIComponent(q)}&page=${page}`),

  latestEpisodes: () =>
    request<Anime[]>('/api/latest-episodes'),

  popular: (type?: 'movies' | 'series') =>
    request<PopularItem[]>(`/api/popular${type ? `?type=${type}` : ''}`),

  info: (slug: string) =>
    request<AnimeInfo>(`/api/info?id=${encodeURIComponent(slug)}`),

  episodes: (slug: string, season?: number) =>
    request<EpisodeList>(
      `/api/episodes/${encodeURIComponent(slug)}${season !== undefined ? `?season=${season}` : ''}`
    ),

  servers: (epSlug: string) =>
    request<Server[]>(`/api/servers?ep=${encodeURIComponent(epSlug)}`),

  stream: (epSlug: string, serverIndex = 0, lang?: string) =>
    request<StreamData>(
      `/api/stream?ep=${encodeURIComponent(epSlug)}&server=${serverIndex}${
        lang ? `&lang=${encodeURIComponent(lang)}` : ''
      }`
    ),

  /**
   * Build the proxied media URL the player should consume.
   * Prefers stream.proxied_url; otherwise wraps any direct URL.
   */
  getProxiedUrl: (stream: StreamData, qualityIndex = 0): string | null => {
    if (stream.proxied_url) return stream.proxied_url;
    const raw =
      stream.direct_hls ||
      stream.qualities?.[qualityIndex]?.url ||
      stream.embedUrl;
    if (!raw) return null;
    return `${API_BASE}/proxy/media?url=${encodeURIComponent(raw)}`;
  },
};