import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Server, StreamData } from '../api/types';
import { MoviPlayer } from '../components/MoviPlayer';
import { ServerControls } from '../components/ServerControls';
import { Error } from '../components/ui/Error';

export default function Watch() {
  const { episode } = useParams<{ episode: string }>();
  const [servers, setServers] = useState<Server[]>([]);
  const [stream, setStream] = useState<StreamData | null>(null);
  const [activeServer, setActiveServer] = useState(0);
  const [activeLang, setActiveLang] = useState<string | undefined>(undefined);
  const [activeQuality, setActiveQuality] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Load servers once on mount
  useEffect(() => {
    if (!episode) return;
    let cancelled = false;
    api
      .servers(episode)
      .then((s) => {
        if (!cancelled) setServers(s);
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [episode]);

  // Load stream whenever selection changes
  useEffect(() => {
    if (!episode || servers.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api
      .stream(episode, activeServer, activeLang)
      .then((s) => {
        if (!cancelled) setStream(s);
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [episode, servers, activeServer, activeLang]);

  // Reset quality when server/lang changes
  useEffect(() => {
    setActiveQuality(0);
  }, [activeServer, activeLang]);

  if (!episode) return <Error message="No episode specified" />;

  // Parse episode for prev/next
  const match = episode.match(/-(\d+)x(\d+)$/);
  const season = match ? Number(match[1]) : 1;
  const epNum = match ? Number(match[2]) : 1;
  const animeSlug = episode.replace(/-\d+x\d+$/, '');

  const handleServerChange = (i: number) => {
    setActiveServer(i);
    setActiveLang(undefined);
  };

  return (
    <div className="animate-fade-in">
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
        title={episode}
        slug={episode}
        onError={(msg) => setErr(msg)}
      />

      {/* Controls */}
      {servers.length > 0 && (
        <ServerControls
          servers={servers}
          activeServer={activeServer}
          activeLang={activeLang}
          activeQuality={activeQuality}
          stream={stream}
          onServerChange={handleServerChange}
          onLangChange={setActiveLang}
          onQualityChange={setActiveQuality}
        />
      )}

      {err && <Error message={err} />}

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