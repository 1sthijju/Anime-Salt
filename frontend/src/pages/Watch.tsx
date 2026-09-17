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

  // Server + stream state
  const [servers, setServers] = useState<Server[]>([]);
  const [stream, setStream] = useState<StreamData | null>(null);
  const [activeServer, setActiveServer] = useState(0);
  const [activeLang, setActiveLang] = useState<string | undefined>(undefined);
  const [activeQuality, setActiveQuality] = useState(0);

  // HLS audio-track state (driven by Movi Player's audioTracks list)
  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [audioTrackIdx, setAudioTrackIdx] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [serversLoading, setServersLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // ------------------------------------------------------------------
  // Reset everything when the episode changes
  // ------------------------------------------------------------------
  useEffect(() => {
    setServers([]);
    setStream(null);
    setActiveServer(0);
    setActiveLang(undefined);
    setActiveQuality(0);
    setAudioTracks([]);
    setAudioTrackIdx(null);
    setErr(null);
    setServersLoading(true);
    setLoading(true);
  }, [episode]);

  // ------------------------------------------------------------------
  // Load servers once per episode
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  // Load the stream whenever server / language selection changes
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!episode || servers.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setAudioTracks([]);
    setAudioTrackIdx(null);

    api
      .stream(episode, activeServer, activeLang)
      .then((s) => {
        if (cancelled) return;
        setStream(s);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr((e as Error).message);
        setStream(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [episode, servers, activeServer, activeLang]);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------
  const handleServerChange = useCallback((i: number) => {
    setActiveServer(i);
    setActiveLang(undefined);
    setActiveQuality(0);
  }, []);

  const handleLangChange = useCallback((lang?: string) => {
    setActiveLang(lang);
    setActiveQuality(0);
  }, []);

  const handleQualityChange = useCallback((i: number) => {
    setActiveQuality(i);
  }, []);

  const handleAudioTrackChange = useCallback((i: number) => {
    setAudioTrackIdx(i);
  }, []);

  const handlePlayerError = useCallback((msg: string) => {
    setErr(msg);
  }, []);

  // ------------------------------------------------------------------
  // Prev / next episode slugs
  // ------------------------------------------------------------------
  if (!episode) {
    return <Error message="No episode specified" />;
  }

  const match = episode.match(/-(\d+)x(\d+)$/);
  const season = match ? Number(match[1]) : 1;
  const epNum = match ? Number(match[2]) : 1;
  const animeSlug = episode.replace(/-\d+x\d+$/, '');
  const prettyTitle = match
    ? `${animeSlug.replace(/-/g, ' ')} — S${season} E${epNum}`
    : episode;

  return (
    <div className="animate-fade-in">
      {/* Back link */}
      <Link
        to={`/anime/${animeSlug}`}
        className="text-sm text-muted hover:text-white mb-4 inline-block"
      >
        ← Back to anime
      </Link>

      {/* Player */}
      <MoviPlayer
        stream={stream}
        qualityIndex={activeQuality}
        loading={loading}
        title={prettyTitle}
        slug={episode}
        onError={handlePlayerError}
        onAudioTracks={setAudioTracks}
        audioTrackIndex={audioTrackIdx}
      />

      {/* Server / language / quality / audio-track controls */}
      {serversLoading ? (
        <Loading text="Loading servers..." />
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
            onServerChange={handleServerChange}
            onLangChange={handleLangChange}
            onQualityChange={handleQualityChange}
            onAudioTrackChange={handleAudioTrackChange}
          />
        </div>
      ) : (
        !err && <Error message="No servers available for this episode" />
      )}

      {/* Errors */}
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