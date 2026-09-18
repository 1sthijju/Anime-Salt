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
  onToggleSubtitle?: (enabled: boolean) => void;
  iframeSrc?: string | null;
  nextEpisodeSlug?: string;
  onSkipIntro?: () => void;
  onSkipOutro?: () => void;
  onNextEpisode?: () => void;
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
  onToggleSubtitle,
  iframeSrc,
  nextEpisodeSlug,
  onSkipIntro,
  onSkipOutro,
  onNextEpisode,
  onError,
  onAudioTracks,
  audioTrackIndex,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  const { save, load } = useResume(slug);
  const [sourceKey, setSourceKey] = useState(0);
  
  // Anime features state
  const [ambientMode, setAmbientMode] = useState(true);
  const [skipIntroVisible, setSkipIntroVisible] = useState(false);
  const [skipOutroVisible, setSkipOutroVisible] = useState(false);

  // ---------------- Custom VTT Subtitle Overlay ----------------
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

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current as any;
      const t = el && typeof el.currentTime === 'number' ? el.currentTime : -1;
      const cue = t >= 0 ? cues.find((c) => t >= c.start && t <= c.end) : undefined;
      const next = cue ? cue.text : '';
      setCueText((prev) => (prev === next ? prev : next));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cues]);

  // ---------------- Source Setup & Ambient Mode ----------------
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !stream || stream.isIframe) return;
    const playUrl = api.getProxiedUrl(stream, qualityIndex);
    if (!playUrl) { onError?.('No playable URL in stream response'); return; }
    
    el.setAttribute('headers', '{}');
    el.setAttribute('engine', stream.source_type === 'hls' ? 'shaka hlsjs native wasm' : 'native wasm');
    el.setAttribute('src', playUrl);
    el.setAttribute('ambient', ambientMode.toString());
    
    setSourceKey((k) => k + 1);
  }, [stream, qualityIndex, onError, ambientMode]);

  // ---------------- Inject Custom Controls (Anime Features) ----------------
  useEffect(() => {
    const el = ref.current as any;
    if (!el || stream?.isIframe) return;

    let controlsAdded = false;
    
    // Poll until the player's API is ready
    const interval = setInterval(() => {
      if (controlsAdded || !el.addControl) return;
      controlsAdded = true;
      clearInterval(interval);

      // 1. Skip Intro
      el.addControl({
        id: 'skip-intro',
        label: 'Skip Intro',
        icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>',
        placement: 'both',
        hotkey: 'shift+i',
        onSelect: () => {
          if (onSkipIntro) onSkipIntro();
          else if (el.seek) el.seek(90);
        },
      });

      // 2. Skip Outro
      el.addControl({
        id: 'skip-outro',
        label: 'Skip Outro',
        icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>',
        placement: 'both',
        hotkey: 'shift+o',
        onSelect: () => {
          if (onSkipOutro) onSkipOutro();
          else if (el.seek && el.duration) el.seek(Math.max(0, el.duration - 90));
        },
      });

      // 3. Next Episode (Only if provided)
      if (nextEpisodeSlug || onNextEpisode) {
        el.addControl({
          id: 'next-episode',
          label: 'Next Episode',
          icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
          placement: 'both',
          hotkey: 'shift+n',
          onSelect: () => {
            if (onNextEpisode) onNextEpisode();
          },
        });
      }

      // 4. Ambient Mode Toggle
      el.addControl({
        id: 'ambient-mode',
        label: 'Ambient Mode',
        icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
        placement: 'both',
        toggle: true,
        active: ambientMode,
        hotkey: 'g',
        onSelect: (on: boolean) => {
          setAmbientMode(on);
          el.setAttribute('ambient', on.toString());
        },
      });
    }, 500);

    return () => clearInterval(interval);
  }, [sourceKey, stream, onSkipIntro, onSkipOutro, onNextEpisode, nextEpisodeSlug, ambientMode]);

  // ---------------- Smart Skip Button Visibility ----------------
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => {
      const time = (el as any).currentTime || 0;
      const duration = (el as any).duration || 0;
      // Show skip intro between 5s and 90s
      setSkipIntroVisible(time > 5 && time < 90);
      // Show skip outro in the last 90 seconds (but not the last 10s so it doesn't block the end screen)
      setSkipOutroVisible(duration > 120 && time > duration - 90 && time < duration - 10);
    };
    el.addEventListener('timeupdate', handler);
    return () => el.removeEventListener('timeupdate', handler);
  }, [sourceKey]);

  // ---------------- Audio Tracks Discovery ----------------
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

  // ---------------- Resume + Persist ----------------
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
      <div className="aspect-video rounded-xl bg-card flex items-center justify-center anime-glow">
        <div className="flex items-center gap-3 text-muted">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-accent border-t-transparent" />
          Loading stream...
        </div>
      </div>
    );
  }

  if (stream?.isIframe && (iframeSrc || stream.embedUrl)) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black border border-border anime-player-container">
        <iframe
          key={iframeSrc || stream.embedUrl}
          src={(iframeSrc || stream.embedUrl) as string}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          loading="eager"
        />
      </div>
    );
  }

  if (!stream) {
    return (
      <div className="aspect-video rounded-xl bg-card border border-red-500/30 flex items-center justify-center">
        <div className="text-center p-6">
          <div className="text-red-400 mb-2">Stream unavailable</div>
          <div className="text-xs text-muted">Try another server or language</div>
        </div>
      </div>
    );
  }

  const hasSubs = !!activeSubtitle;

  return (
    <div className="relative anime-player-container">
      <movi-player
        ref={ref}
        controls
        autoplay
        resume
        theme="dark"
        ambient={ambientMode.toString()}
        title={title || ''}
        persist="volume speed audiolang subtitlelang ambient"
        persistkey="animesalt"
        className="anime-player"
      />

      {/* Ambient CC Button (Top Right) */}
      {onToggleSubtitle && (stream?.subtitles?.length ?? 0) > 0 && (
        <button
          onClick={() => onToggleSubtitle(!hasSubs)}
          title="Toggle subtitles"
          className={`absolute top-4 right-4 z-20 rounded-md px-3 py-1.5 text-xs font-bold backdrop-blur-md border transition-all ${
            hasSubs
              ? 'bg-accent/90 border-accent text-white shadow-lg shadow-accent/50'
              : 'bg-black/50 border-white/20 text-white/70 hover:text-white'
          }`}
        >
          CC
        </button>
      )}

      {/* Custom VTT Subtitle Overlay */}
      {cueText && (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-10 flex justify-center px-6">
          <div
            className="rounded-md bg-black/80 px-4 py-2 text-center text-sm md:text-lg text-white whitespace-pre-line leading-snug anime-subtitle-text"
            style={{ textShadow: '0 2px 4px rgba(0,0,0,0.9), 0 0 8px rgba(139, 92, 246, 0.5)' }}
          >
            {cueText}
          </div>
        </div>
      )}

      {/* Smart Skip Intro Overlay */}
      {skipIntroVisible && (
        <button
          onClick={() => {
            if (onSkipIntro) onSkipIntro();
            else (ref.current as any)?.seek?.(90);
            setSkipIntroVisible(false);
          }}
          className="absolute bottom-24 right-4 z-30 px-4 py-2 bg-black/70 hover:bg-accent text-white rounded-lg backdrop-blur-md transition-all animate-fade-in skip-button"
        >
          Skip Intro →
        </button>
      )}

      {/* Smart Skip Outro Overlay */}
      {skipOutroVisible && (
        <button
          onClick={() => {
            if (onSkipOutro) onSkipOutro();
            else {
              const duration = (ref.current as any)?.duration || 0;
              (ref.current as any)?.seek?.(Math.max(0, duration - 90));
            }
            setSkipOutroVisible(false);
          }}
          className="absolute bottom-24 right-4 z-30 px-4 py-2 bg-black/70 hover:bg-accent text-white rounded-lg backdrop-blur-md transition-all animate-fade-in skip-button"
        >
          Skip Outro →
        </button>
      )}
    </div>
  );
}