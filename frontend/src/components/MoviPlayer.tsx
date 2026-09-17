import { useRef, useEffect, useLayoutEffect } from 'react';
import type { StreamData } from '../api/types';
import { api } from '../api/client';
import { useResume } from '../hooks/useResume';

interface Props {
  stream: StreamData | null;
  qualityIndex: number;
  loading?: boolean;
  title?: string;
  slug: string;
  onError?: (message: string) => void;
}

export function MoviPlayer({ stream, qualityIndex, loading, title, slug, onError }: Props) {
  const ref = useRef<HTMLElement>(null);
  const { save, load } = useResume(slug);

  // Set source + attributes once the stream resolves
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !stream || stream.isIframe) return;

    const playUrl = api.getProxiedUrl(stream, qualityIndex);
    if (!playUrl) {
      onError?.('No playable URL in stream response');
      return;
    }

    const headers: Record<string, string> = {};
    // Referer/Origin are injected server-side by /proxy/media — nothing needed client-side
    el.setAttribute('headers', JSON.stringify(headers));
    el.setAttribute(
      'engine',
      stream.source_type === 'hls' ? 'shaka hlsjs native wasm' : 'native wasm'
    );
    el.setAttribute('src', playUrl);
  }, [stream, qualityIndex, onError]);

  // Resume position once the element is ready
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const resumeTime = load();
    if (resumeTime === null) return;

    const handler = () => {
      try {
        (el as any).currentTime = resumeTime;
      } catch {}
      el.removeEventListener('loadedmetadata', handler);
    };
    el.addEventListener('loadedmetadata', handler);
    return () => el.removeEventListener('loadedmetadata', handler);
  }, [stream, load]);

  // Save position on pause + periodically
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onPause = () => {
      try {
        save((el as any).currentTime || 0, (el as any).duration || 0);
      } catch {}
    };
    const onTimeUpdate = () => {
      try {
        save((el as any).currentTime || 0, (el as any).duration || 0);
      } catch {}
    };
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTimeUpdate);
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