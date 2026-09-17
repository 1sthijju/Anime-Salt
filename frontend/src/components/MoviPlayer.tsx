import { useRef, useEffect, useLayoutEffect } from 'react';
import type { StreamData } from '../api/types';
import { api } from '../api/client';
import { useResume } from '../hooks/useResume';

export interface AudioTrackInfo {
  index: number;
  label: string;
  language: string;
}

interface Props {
  stream: StreamData | null;
  qualityIndex: number;
  loading?: boolean;
  title?: string;
  slug: string;
  onError?: (message: string) => void;
  onAudioTracks?: (tracks: AudioTrackInfo[]) => void;
  audioTrackIndex?: number | null;
}

export function MoviPlayer({
  stream, qualityIndex, loading, title, slug, onError, onAudioTracks, audioTrackIndex,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  const { save, load } = useResume(slug);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !stream || stream.isIframe) return;
    const playUrl = api.getProxiedUrl(stream, qualityIndex);
    if (!playUrl) { onError?.('No playable URL in stream response'); return; }
    el.setAttribute('headers', '{}');
    el.setAttribute('engine', stream.source_type === 'hls' ? 'shaka hlsjs native wasm' : 'native wasm');
    el.setAttribute('src', playUrl);
  }, [stream, qualityIndex, onError]);

  // Report HLS audio renditions upward
  useEffect(() => {
    const el = ref.current;
    if (!el || !onAudioTracks) return;
    const read = () => {
      const list = (el as any).audioTracks;
      if (!list || !list.length) { onAudioTracks([]); return; }
      onAudioTracks(
        Array.from(list).map((t: any, i: number) => ({
          index: i,
          label: t.label || t.language || `Audio ${i + 1}`,
          language: t.language || '',
        }))
      );
    };
    read();
    el.addEventListener('trackschange', read);
    el.addEventListener('loadedmetadata', read);
    return () => {
      el.removeEventListener('trackschange', read);
      el.removeEventListener('loadedmetadata', read);
    };
  }, [stream, onAudioTracks]);

  // Apply selected audio track
  useEffect(() => {
    const el = ref.current;
    if (!el || audioTrackIndex == null) return;
    const list = (el as any).audioTracks;
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i].enabled = i === audioTrackIndex;
    try { list.selectedIndex = audioTrackIndex; } catch {}
  }, [audioTrackIndex, stream]);

  // Resume
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resumeTime = load();
    if (resumeTime === null) return;
    const handler = () => {
      try { (el as any).currentTime = resumeTime; } catch {}
      el.removeEventListener('loadedmetadata', handler);
    };
    el.addEventListener('loadedmetadata', handler);
    return () => el.removeEventListener('loadedmetadata', handler);
  }, [stream, load]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const persist = () => {
      try { save((el as any).currentTime || 0, (el as any).duration || 0); } catch {}
    };
    el.addEventListener('pause', persist);
    el.addEventListener('timeupdate', persist);
    return () => {
      el.removeEventListener('pause', persist);
      el.removeEventListener('timeupdate', persist);
    };
  }, [save]);

  if (loading) {
    return (
      <div className="aspect-video rounded-xl bg-card flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-accent border-t-transparent" />
          Loading stream...
        </div>
      </div>
    );
  }

  if (!stream || stream.isIframe) {
    return (
      <div className="aspect-video rounded-xl bg-card border border-red-500/30 flex items-center justify-center">
        <div className="text-center p-6">
          <div className="text-red-400 mb-2">Stream unavailable</div>
          <div className="text-xs text-muted">Try another server or language</div>
        </div>
      </div>
    );
  }

  return (
    <movi-player
      ref={ref}
      controls
      autoplay
      resume
      theme="dark"
      title={title || ''}
      persist="volume speed audiolang subtitlelang"
      persistkey="animesalt"
    />
  );
}