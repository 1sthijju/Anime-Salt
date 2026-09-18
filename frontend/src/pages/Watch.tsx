import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Server, StreamData } from '../api/types';
import { MoviPlayer, type AudioTrackInfo } from '../components/MoviPlayer';
import { ServerControls } from '../components/ServerControls';

export default function Watch() {
  const { episode } = useParams<{ episode: string }>();
  const [servers, setServers] = useState<Server[]>([]);
  const [stream, setStream] = useState<StreamData | null>(null);
  const [activeServer, setActiveServer] = useState(0);
  const [activeLang, setActiveLang] = useState<string | undefined>(undefined);
  const [hlsAudio, setHlsAudio] = useState<string | undefined>(undefined);
  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [audioTrackIdx, setAudioTrackIdx] = useState<number | null>(null);
  const [subtitleIdx, setSubtitleIdx] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);
  const [serversLoading, setServersLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setServers([]);
    setStream(null);
    setActiveServer(0);
    setActiveLang(undefined);
    setHlsAudio(undefined);
    setAudioTracks([]);
    setAudioTrackIdx(null);
    setSubtitleIdx(0);
    setErr(null);
    setServersLoading(true);
    setLoading(true);
  }, [episode]);

  useEffect(() => {
    if (!episode) return;
    let cancelled = false;
    api.servers(episode)
      .then((s) => { if (!cancelled) { setServers(s); setServersLoading(false); } })
      .catch((e) => { if (!cancelled) { setErr((e as Error).message); setServersLoading(false); } });
    return () => { cancelled = true; };
  }, [episode]);

  useEffect(() => {
    if (!episode || servers.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setAudioTracks([]);
    setAudioTrackIdx(null);
    api.stream(episode, activeServer, activeLang, hlsAudio)
      .then((s) => { if (!cancelled) setStream(s); })
      .catch((e) => { if (!cancelled) { setErr((e as Error).message); setStream(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [episode, servers, activeServer, activeLang, hlsAudio]);

  const handleServerChange = useCallback((i: number) => {
    setActiveServer(i);
    setActiveLang(undefined);
    setHlsAudio(undefined);
  }, []);

  const handleLangChange = useCallback((lang?: string) => setActiveLang(lang), []);
  const handleAudioLangChange = useCallback((code: string) => setHlsAudio((prev) => (prev === code ? undefined : code)), []);
  const handleAudioTrackChange = useCallback((i: number) => setAudioTrackIdx(i), []);
  const handleSubtitleChange = useCallback((i: number | null) => setSubtitleIdx(i), []);
  const handleToggleSubtitle = useCallback((enabled: boolean) => setSubtitleIdx((prev) => (enabled ? (prev === null ? 0 : prev) : null)), []);
  const handlePlayerError = useCallback((msg: string) => setErr(msg), []);

  if (!episode) return <div className="container-x py-32 text-center text-muted">No episode</div>;

  const match = episode.match(/-(\d+)x(\d+)$/);
  const season = match ? Number(match[1]) : 1;
  const epNum = match ? Number(match[2]) : 1;
  const animeSlug = episode.replace(/-\d+x\d+$/, '');
  const prettyTitle = match ? `${animeSlug.replace(/-/g, ' ')} — S${season} E${epNum}` : episode;

  const currentServer = servers[activeServer];
  const iframeSrc = (activeLang && currentServer?.languages?.find((l) => l.language === activeLang)?.link) || null;

  return (
    <div className="container-x py-8">
      <Link to={`/anime/${animeSlug}`} className="text-sm text-muted hover:text-white mb-4 inline-block">
        ← Back to anime
      </Link>

      <MoviPlayer
        stream={stream}
        loading={loading}
        title={prettyTitle}
        slug={episode}
        activeSubtitle={stream?.subtitles?.[subtitleIdx ?? -1] ?? null}
        onToggleSubtitle={handleToggleSubtitle}
        iframeSrc={iframeSrc}
        onError={handlePlayerError}
        onAudioTracks={setAudioTracks}
        audioTrackIndex={audioTrackIdx}
      />

      {serversLoading ? (
        <div className="mt-4 skeleton h-40" />
      ) : servers.length > 0 ? (
        <div className="mt-4">
          <ServerControls
            servers={servers}
            activeServer={activeServer}
            activeLang={activeLang}
            stream={stream}
            audioTracks={audioTracks}
            audioTrackIndex={audioTrackIdx}
            audioLanguages={stream?.audio_languages}
            activeAudioLang={stream?.selected_audio ?? null}
            subtitles={stream?.subtitles ?? []}
            activeSubtitleIndex={subtitleIdx}
            onServerChange={handleServerChange}
            onLangChange={handleLangChange}
            onAudioTrackChange={handleAudioTrackChange}
            onAudioLangChange={handleAudioLangChange}
            onSubtitleChange={handleSubtitleChange}
          />
        </div>
      ) : (
        !err && <div className="mt-4 text-center text-muted">No servers</div>
      )}

      {err && <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{err}</div>}

      <div className="mt-6 flex flex-wrap gap-3">
        {epNum > 1 && (
          <Link to={`/watch/${animeSlug}-${season}x${epNum - 1}`} className="btn-ghost">
            ← Previous
          </Link>
        )}
        <Link to={`/watch/${animeSlug}-${season}x${epNum + 1}`} className="btn-primary ml-auto">
          Next Episode →
        </Link>
      </div>
    </div>
  );
}