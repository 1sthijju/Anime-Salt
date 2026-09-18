import { useRef, useEffect, useLayoutEffect, useState } from 'react';
import type { StreamData, Subtitle } from '../api/types';
import { api } from '../api/client';
import { useResume } from '../hooks/useResume';
import { parseVtt, type VttCue } from '../lib/vtt';

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
  activeSubtitle?: Subtitle | null;
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
  activeSubtitle,
  onError,
  onAudioTracks,
  audioTrackIndex,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  const { save, load } = useResume(slug);
  const [sourceKey, setSourceKey] = useState(0);

  // ---------------- Subtitle overlay state ----------------
  const [cues, setCues] = useState<VttCue[]>([]);
  const [cueText, setCueText] = useState('');

  useEffect(() => {
    let cancelled = false;
    setCues([]);
    setCueText('');
    if (!activeSubtitle?.url) return;
    fetch(activeSubtitle.url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => { if (!cancelled) setCues(parseVtt(t)); })
      .catch((e) => console.error('Subtitle fetch failed:', activeSubtitle.url, e));
    return () => { cancelled = true; };
  }, [activeSubtitle?.url]);

  // rAF-synced cue display (smoother than timeupdate)
  useEffect(() => {
    if (!cues.length) return;
    let raf = 0;
    const tick = () => {
      const el = ref.current as any;
      if (el && typeof el.currentTime === 'number') {
        const t = el.currentTime;
        const cue = cues.find((c) => t >= c.start && t <= c.end);
        const next = cue ? cue.text : '';
        setCueText((prev) => (prev === next ? prev : next));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cues]);

  // ---------------- Source ----------------
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !stream || stream.isIframe) return;
    const playUrl = api.getProxiedUrl(stream, qualityIndex);
    if (!playUrl) { onError?.('No playable URL in stream response'); return; }
    el.setAttribute('headers', '{}');
    el.setAttribute('engine', stream.source_type === 'hls' ? 'shaka hlsjs native wasm' : 'native wasm');
    el.setAttribute('src', playUrl);
    setSourceKey((k) => k + 1);
  }, [stream, qualityIndex, onError]);

  // ---------------- Audio tracks ----------------
  useEffect(() => {
    const el = ref.current;
    if (!el || !onAudioTracks) return;
    const readTracks = () => {
      const list = (el as any).audioTracks;
      if (!list || !list.length) { onAudioTracks([]); return; }
      onAudioTracks(
        Array.from(list).map((t: any, i: number) => ({
          index: typeof t.id === 'number' ? t.id : i,
          label: t.label || t.name || t.language || `Audio ${i + 1}`,
          language: t.language || '',
        }))
      );
    };
    readTracks();
    const events = ['loadedmetadata', 'canplay', 'playing', 'trackschange'];
    events.forEach((evt) => el.addEventListener(evt, readTracks));
    const timers = [window.setTimeout(readTracks, 800), window.setTimeout(readTracks, 2500)];
    return () => {
      events.forEach((evt) => el.removeEventListener(evt, readTracks));
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [sourceKey, onAudioTracks]);

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

  // ---------------- Resume + persist ----------------
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

  // ---------------- Render ----------------
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
    <div className="relative">
      <movi-player
        ref={ref}
        controls
        autoplay
        resume
        theme="dark"
        title={title || ''}
        persist="volume speed audiolang"
        persistkey="animesalt"
      />
      {cueText && (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-10 flex justify-center px-6">
          <div
            className="rounded-md bg-black/70 px-3 py-1.5 text-center text-sm md:text-base text-white whitespace-pre-line leading-snug"
            style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}
          >
            {cueText}
          </div>
        </div>
      )}
    </div>
  );
}