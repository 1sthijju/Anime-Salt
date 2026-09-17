import { useRef, useEffect, useLayoutEffect, useState } from 'react';
import type { StreamData, Subtitle } from '../api/types';
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
  subtitles?: Subtitle[];
  onError?: (message: string) => void;
  onAudioTracks?: (tracks: AudioTrackInfo[]) => void;
  audioTrackIndex?: number | null;
}

export function MoviPlayer({
  stream,
  qualityIndex,
  loading,
  title,
  slug,
  subtitles,
  onError,
  onAudioTracks,
  audioTrackIndex,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  const { save, load } = useResume(slug);
  const [sourceKey, setSourceKey] = useState(0);

  // ------------------------------------------------------------
  // Set the source whenever stream / quality changes
  // ------------------------------------------------------------
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !stream || stream.isIframe) return;

    const playUrl = api.getProxiedUrl(stream, qualityIndex);
    if (!playUrl) {
      onError?.('No playable URL in stream response');
      return;
    }

    // Referer/Origin are injected server-side by /proxy/media
    el.setAttribute('headers', '{}');
    el.setAttribute(
      'engine',
      stream.source_type === 'hls' ? 'shaka hlsjs native wasm' : 'native wasm'
    );
    el.setAttribute('src', playUrl);
    setSourceKey((k) => k + 1);
  }, [stream, qualityIndex, onError]);

  // ------------------------------------------------------------
  // Discover audio tracks (HLS audio groups load asynchronously)
  // ------------------------------------------------------------
  useEffect(() => {
    const el = ref.current;
    if (!el || !onAudioTracks) return;

    const readTracks = (e?: any) => {
      // Prefer the trackschange payload, fall back to el.audioTracks
      let list: any[] = Array.isArray(e?.detail) ? e.detail : [];
      if (list.length === 0) {
        const at = (el as any).audioTracks;
        list = at && at.length ? Array.from(at) : [];
      }
      const audio = list
        .map((t: any, i: number) => ({
          index: typeof t.index === 'number' ? t.index : i,
          label: t.label || t.name || t.language || `Audio ${i + 1}`,
          language: t.language || '',
        }))
        .filter((t: any) => !t.language || true); // keep all; type filter below if available
      const filtered = list.length
        ? list
            .filter((t: any) => (t.type || t.kind || '').toString().includes('audio') || !(t.type || t.kind))
            .map((t: any, i: number) => ({
              index: typeof t.index === 'number' ? t.index : i,
              label: t.label || t.name || t.language || `Audio ${i + 1}`,
              language: t.language || '',
            }))
        : audio;
      onAudioTracks(filtered);
    };

    readTracks();

    const events = ['loadedmetadata', 'canplay', 'playing', 'trackschange'];
    events.forEach((evt) => el.addEventListener(evt, readTracks));

    // Late retries — some engines expose tracks only after demuxing starts
    const timers = [
      window.setTimeout(readTracks, 800),
      window.setTimeout(readTracks, 2500),
    ];

    return () => {
      events.forEach((evt) => el.removeEventListener(evt, readTracks));
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [sourceKey, onAudioTracks]);

  // ------------------------------------------------------------
  // Apply the selected audio track
  // ------------------------------------------------------------
  useEffect(() => {
    const el = ref.current;
    if (!el || audioTrackIndex == null) return;
    const list = (el as any).audioTracks;
    if (!list || !list.length) return;
    for (let i = 0; i < list.length; i++) {
      try { list[i].enabled = i === audioTrackIndex; } catch {}
    }
    try { list.selectedIndex = audioTrackIndex; } catch {}
  }, [audioTrackIndex, sourceKey]);

  // ------------------------------------------------------------
  // Resume playback position
  // ------------------------------------------------------------
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
  }, [sourceKey, load]);

  // ------------------------------------------------------------
  // Persist playback position
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // Render states
  // ------------------------------------------------------------
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
    >
      {(subtitles || []).map((s, i) => (
        <track
          key={s.url}
          src={s.url}
          srclang="en"
          label={s.label}
          kind="subtitles"
          default={i === 0 ? true : undefined}
        />
      ))}
    </movi-player>
  );
}