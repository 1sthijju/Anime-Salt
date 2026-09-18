import type { Server, StreamData, AudioLanguage, Subtitle } from '../api/types';
import type { AudioTrackInfo } from './MoviPlayer';
import { Badge } from './ui/Badge';

interface Props {
  servers: Server[];
  activeServer: number;
  activeLang?: string;
  activeQuality: number;
  stream: StreamData | null;
  audioTracks?: AudioTrackInfo[];
  audioTrackIndex?: number | null;
  audioLanguages?: AudioLanguage[];
  activeAudioLang?: string | null;
  subtitles?: Subtitle[];
  activeSubtitleIndex?: number | null;
  onServerChange: (i: number) => void;
  onLangChange: (lang?: string) => void;
  onQualityChange: (i: number) => void;
  onAudioTrackChange?: (i: number) => void;
  onAudioLangChange?: (code: string) => void;
  onSubtitleChange?: (i: number | null) => void;
}

export function ServerControls({
  servers, activeServer, activeLang, activeQuality, stream,
  audioTracks = [], audioTrackIndex = null,
  audioLanguages = [], activeAudioLang = null,
  subtitles = [], activeSubtitleIndex = null,
  onServerChange, onLangChange, onQualityChange,
  onAudioTrackChange, onAudioLangChange, onSubtitleChange,
}: Props) {
  const current = servers[activeServer];
  const hasMultiLang = current?.isMultiLang && current.languages.length > 0;
  const qualities = stream?.qualities;
  const hasMultiQuality = !!qualities && qualities.length > 1;
  const hasMultiAudioTracks = audioTracks.length > 1;
  const hasManifestAudio = audioLanguages.length > 1 && audioTracks.length < 2;

  return (
    <div className="bg-card rounded-xl p-4 space-y-3">
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

      {hasMultiAudioTracks && onAudioTrackChange && (
        <div className="pt-3 border-t border-border">
          <div className="text-xs text-muted mb-2 uppercase tracking-wide">Audio track</div>
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

      {subtitles.length > 0 && onSubtitleChange && (
        <div className="pt-3 border-t border-border">
          <div className="text-xs text-muted mb-2 uppercase tracking-wide">Subtitles</div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="violet"
              active={activeSubtitleIndex == null}
              onClick={() => onSubtitleChange(null)}
            >
              Off
            </Badge>
            {subtitles.map((s, i) => (
              <Badge
                key={s.url}
                variant="violet"
                active={activeSubtitleIndex === i}
                onClick={() => onSubtitleChange(i)}
              >
                {s.label}
              </Badge>
            ))}
          </div>
        </div>
      )}

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
              </Badge>
            ))}
          </div>
        </div>
      )}

      {stream && (
        <div className="pt-3 border-t border-border text-xs text-muted flex flex-wrap gap-3">
          {stream.host && <span>Host: {stream.host}</span>}
          {stream.source_type && <span>Type: {stream.source_type.toUpperCase()}</span>}
          {stream.selected_audio && <span>HLS audio: {stream.selected_audio}</span>}
          <span className="opacity-60">via media proxy</span>
        </div>
      )}
    </div>
  );
}