import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Server, StreamData } from '../api/types';
import { MoviPlayer, type AudioTrackInfo } from '../components/MoviPlayer';
import { ServerControls } from '../components/ServerControls';
import { Error } from '../components/ui/Error';
import { Loading } from '../components/ui/Loading';

export default function Watch() {
  const { episode } = useParams<{ episode: string }>();

  // Servers + stream
  const [servers, setServers] = useState<Server[]>([]);
  const [stream, setStream] = useState<StreamData | null>(null);
  const [activeServer, setActiveServer] = useState(0);
  const [activeLang, setActiveLang] = useState<string | undefined>(undefined);
  const [activeQuality, setActiveQuality] = useState(0);

  // Manifest-driven HLS audio language (server-side DEFAULT switching)
  const [hlsAudio, setHlsAudio] = useState<string | undefined>(undefined);

  // Player-exposed audio tracks
  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [audioTrackIdx, setAudioTrackIdx] = useState<number | null>(null);

  // Subtitle selection (null = off, 0+ = index into stream.subtitles)
  const [subtitleIdx, setSubtitleIdx] = useState<number | null>(0);

  const [loading, setLoading] = useState(true);
  const [serversLoading, setServersLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // ------------------------------------------------------------
  // Reset all state when the episode changes
  // ------------------------------------------------------------
  useEffect(() => {
    setServers([]);
    setStream(null);
    setActiveServer(0);
    setActiveLang(undefined);
    setActiveQuality(0);
    setHlsAudio(undefined);
    setAudioTracks([]);
    setAudioTrackIdx(null);
    setSubtitleIdx(0);
    setErr(null);
    setServersLoading(true);
    setLoading(true);
  }, [episode]);

  // ------------------------------------------------------------
  // Load servers once per episode
  // ------------------------------------------------------------
  useEffect(() => {
    if (!episode) return;
    let cancelled = false;
    api
      .servers(episode)
      .then((s) => {
        if (cancelled) return;
        setServers(s);
        setServersLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr((e as Error).message);
        setServersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [episode]);

  // ------------------------------------------------------------
  // Load stream on every selection change
  // ------------------------------------------------------------
  useEffect(() => {
    if (!episode || servers.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setAudioTracks([]);
    setAudioTrackIdx(null);
    setActiveQuality(0);

    api
      .stream(episode, activeServer, activeLang, hlsAudio)
      .then((s) => {
        if (cancelled) return;
        setStream(s);
        // Auto-enable first subtitle if available and user hasn't explicitly turned them off
        if (s.subtitles && s.subtitles.length > 0 && subtitleIdx === null) {
          setSubtitleIdx(0);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setErr((e as Error).message);
        setStream(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [episode, servers, activeServer, activeLang, hlsAudio]);

  // ------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------
  const handleServerChange = useCallback((i: number) => {
    setActiveServer(i);
    setActiveLang(undefined);
    setHlsAudio(undefined);
  }, []);

  const handleLangChange = useCallback((lang?: string) => {
    setActiveLang(lang);
  }, []);

  const handleAudioLangChange = useCallback((code: string) => {
    setHlsAudio((prev) => (prev === code ? undefined : code));
  }, []);

  const handleQualityChange = useCallback((i: number) => {
    setActiveQuality(i);
  }, []);

  const handleAudioTrackChange = useCallback((i: number) => {
    setAudioTrackIdx(i);
  }, []);

  const handleSubtitleChange = useCallback((i: number | null) => {
    setSubtitleIdx(i);
  }, []);

  const handleToggleSubtitle = useCallback((enabled: boolean) => {
    setSubtitleIdx((prev) => {
      if (enabled) return prev === null ? 0 : prev;
      return null;
    });
  }, []);

  const handlePlayerError = useCallback((msg: string) => {
    setErr(msg);
  }, []);

  if (!episode) {
    return <Error message="No episode specified" />;
  }

  // ------------------------------------------------------------
  // Prev / next episode slugs + pretty title
  // ------------------------------------------------------------
  const match = episode.match(/-(\d+)x(\d+)$/);
  const season = match ? Number(match[1]) : 1;
  const epNum = match ? Number(match[2]) : 1;
  const animeSlug = episode.replace(/-\d+x\d+$/, '');
  const prettyTitle = match
    ? `${animeSlug.replace(/-/g, ' ')} — S${season} E${epNum}`
    : episode;

  return (
    <div className="animate-fade-in">
      <Link
        to={`/anime/${animeSlug}`}
        className="text-sm text-muted hover:text-white mb-4 inline-block"
      >
        ← Back to anime
      </Link>

      {/* Player (with custom subtitle overlay + CC button) */}
      <MoviPlayer
        stream={stream}
        qualityIndex={activeQuality}
        loading={loading}
        title={prettyTitle}
        slug={episode}
        activeSubtitle={stream?.subtitles?.[subtitleIdx ?? -1] ?? null}
        onToggleSubtitle={handleToggleSubtitle}
        onError={handlePlayerError}
        onAudioTracks={setAudioTracks}
        audioTrackIndex={audioTrackIdx}
      />

      {/* Controls */}
      {serversLoading ? (
        <div className="mt-4">
          <Loading text="Loading servers..." />
        </div>
      ) : servers.length > 0 ? (
        <div className="mt-4">
          <ServerControls
            servers={servers}
            activeServer={activeServer}
            activeLang={activeLang}
            activeQuality={activeQuality}
            stream={stream}
            audioTracks={audioTracks}
            audioTrackIndex={audioTrackIdx}
            audioLanguages={stream?.audio_languages}
            activeAudioLang={stream?.selected_audio ?? null}
            subtitles={stream?.subtitles ?? []}
            activeSubtitleIndex={subtitleIdx}
            onServerChange={handleServerChange}
            onLangChange={handleLangChange}
            onQualityChange={handleQualityChange}
            onAudioTrackChange={handleAudioTrackChange}
            onAudioLangChange={handleAudioLangChange}
            onSubtitleChange={handleSubtitleChange}
          />
        </div>
      ) : (
        !err && <Error message="No servers available for this episode" />
      )}

      {err && (
        <div className="mt-4">
          <Error message={err} />
        </div>
      )}

      {/* Episode navigation */}
      <div className="mt-6 flex flex-wrap gap-3">
        {epNum > 1 && (
          <Link
            to={`/watch/${animeSlug}-${season}x${epNum - 1}`}
            className="px-4 py-2 bg-card border border-border hover:border-accent rounded-lg text-sm transition"
          >
            ← Previous
          </Link>
        )}
        <Link
          to={`/watch/${animeSlug}-${season}x${epNum + 1}`}
          className="px-4 py-2 bg-accent hover:bg-accent/80 rounded-lg text-sm ml-auto transition"
        >
          Next Episode →
        </Link>
      </div>
    </div>
  );
}