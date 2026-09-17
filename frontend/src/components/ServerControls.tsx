import type { Server, StreamData, AudioLanguage } from '../api/types';
import type { AudioTrackInfo } from './MoviPlayer';
import { Badge } from './ui/Badge';

interface Props {
  servers: Server[];
  activeServer: number;
  activeLang?: string;
  activeQuality: number;
  stream: StreamData | null;

  // Player-exposed HLS audio tracks (bonus row)
  audioTracks?: AudioTrackInfo[];
  audioTrackIndex?: number | null;

  // Manifest-driven audio languages (server-side control)
  audioLanguages?: AudioLanguage[];
  activeAudioLang?: string | null;

  onServerChange: (i: number) => void;
  onLangChange: (lang?: string) => void;
  onQualityChange: (i: number) => void;
  onAudioTrackChange?: (i: number) => void;
  onAudioLangChange?: (code: string) => void;
}

export function ServerControls({
  servers,
  activeServer,
  activeLang,
  activeQuality,
  stream,
  audioTracks = [],
  audioTrackIndex = null,
  audioLanguages = [],
  activeAudioLang = null,
  onServerChange,
  onLangChange,
  onQualityChange,
  onAudioTrackChange,
  onAudioLangChange,
}: Props) {
  const current = servers[activeServer];
  const hasMultiLang = current?.isMultiLang && current.languages.length > 0;
  const qualities = stream?.qualities;
  const hasMultiQuality = !!qualities && qualities.length > 1;
  const hasMultiAudioTracks = audioTracks.length > 1;
  const hasManifestAudio = audioLanguages.length > 1;

  return (
    <div className="bg-card rounded-xl p-4 space-y-3">
      {/* Servers */}
      <div>
        <div className="text-xs text-muted mb-2 uppercase tracking-wide">Server</div>
        <div className="flex flex-wrap gap-2">
          {servers.map((s, i) => (
            <Badge key={i} active={i === activeServer} onClick={() => onServerChange(i)}>
              {s.serverName}
              {s.isMultiLang && <span className="ml-1">🌐</span>}
            </Badge>
          ))}
        </div>
      </div>

      {/* Abyss multi-lang (English / Japanese links) */}
      {hasMultiLang && (
        <div className="pt-3 border-t border-border">
          <div className="text-xs text-muted mb-2 uppercase tracking-wide">Audio (server)</div>
          <div className="flex flex-wrap gap-2">
            {current.languages.map((l) => (
              <Badge
                key={l.language}
                variant="cyan"
                active={activeLang === l.language}
                onClick={() => onLangChange(activeLang === l.language ? undefined : l.language)}
              >
                {l.language}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* HLS manifest audio languages (server-side DEFAULT switching) */}
      {hasManifestAudio && onAudioLangChange && (
        <div className="pt-3 border-t border-border">
          <div className="text-xs text-muted mb-2 uppercase tracking-wide">Audio language</div>
          <div className="flex flex-wrap gap-2">
            {audioLanguages.map((a) => (
              <Badge
                key={a.code}
                variant="cyan"
                active={(activeAudioLang ?? audioLanguages[0].code) === a.code}
                onClick={() => onAudioLangChange(a.code)}
              >
                {a.name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Player-exposed audio tracks (when the engine surfaces them) */}
      {hasMultiAudioTracks && onAudioTrackChange && (
        <div className="pt-3 border-t border-border">
          <div className="text-xs text-muted mb-2 uppercase tracking-wide">Audio track (player)</div>
          <div className="flex flex-wrap gap-2">
            {audioTracks.map((t) => (
              <Badge
                key={t.index}
                variant="cyan"
                active={(audioTrackIndex ?? 0) === t.index}
                onClick={() => onAudioTrackChange(t.index)}
              >
                {t.label}
                {t.language && <span className="ml-1 opacity-70">[{t.language}]</span>}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Quality ladder */}
      {hasMultiQuality && (
        <div className="pt-3 border-t border-border">
          <div className="text-xs text-muted mb-2 uppercase tracking-wide">Quality</div>
          <div className="flex flex-wrap gap-2">
            {qualities!.map((q, i) => (
              <Badge
                key={i}
                variant="violet"
                active={activeQuality === i}
                onClick={() => onQualityChange(i)}
              >
                {q.resolution || `Q${i + 1}`}
                {q.size && (
                  <span className="ml-1 opacity-70">
                    ({Math.round(q.size / (1024 * 1024))}MB)
                  </span>
                )}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Stream metadata */}
      {stream && (
        <div className="pt-3 border-t border-border text-xs text-muted flex flex-wrap gap-3">
          {stream.host && <span>Host: {stream.host}</span>}
          {stream.source_type && <span>Type: {stream.source_type.toUpperCase()}</span>}
          {stream.selectedLanguage && <span>Server audio: {stream.selectedLanguage}</span>}
          {stream.selected_audio && <span>HLS audio: {stream.selected_audio}</span>}
          {stream.subtitles && stream.subtitles.length > 0 && (
            <span>Subs: {stream.subtitles.map((s) => s.label).join(', ')}</span>
          )}
          <span className="opacity-60">via media proxy</span>
        </div>
      )}
    </div>
  );
}