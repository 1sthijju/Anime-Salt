import type { Server, StreamData, AudioLanguage, Subtitle } from '../api/types';
import type { AudioTrackInfo } from './MoviPlayer';

interface Props {
  servers: Server[];
  activeServer: number;
  activeLang?: string;
  stream: StreamData | null;
  audioTracks?: AudioTrackInfo[];
  audioTrackIndex?: number | null;
  audioLanguages?: AudioLanguage[];
  activeAudioLang?: string | null;
  subtitles?: Subtitle[];
  activeSubtitleIndex?: number | null;
  onServerChange: (i: number) => void;
  onLangChange: (lang?: string) => void;
  onAudioTrackChange?: (i: number) => void;
  onAudioLangChange?: (code: string) => void;
  onSubtitleChange?: (i: number | null) => void;
}

export function ServerControls({
  servers, activeServer, activeLang, stream,
  audioTracks = [], audioTrackIndex = null,
  audioLanguages = [], activeAudioLang = null,
  subtitles = [], activeSubtitleIndex = null,
  onServerChange, onLangChange,
  onAudioTrackChange, onAudioLangChange, onSubtitleChange,
}: Props) {
  const current = servers[activeServer];
  const hasMultiLang = current?.isMultiLang && current.languages.length > 0;
  const hasMultiAudioTracks = audioTracks.length > 1;
  const hasManifestAudio = audioLanguages.length > 1 && audioTracks.length < 2;

  return (
    <div className="bg-card rounded-xl p-4 space-y-3">
      <div>
        <div className="text-xs text-muted mb-2 uppercase tracking-wide">Server</div>
        <div className="flex flex-wrap gap-2">
          {servers.map((s, i) => (
            <button
              key={i}
              onClick={() => onServerChange(i)}
              className={`chip ${i === activeServer ? 'chip-active' : ''}`}
            >
              {s.serverName}
            </button>
          ))}
        </div>
      </div>

      {hasMultiLang && (
        <div className="pt-3 border-t border-line">
          <div className="text-xs text-muted mb-2 uppercase tracking-wide">Audio Language</div>
          <div className="flex flex-wrap gap-2">
            {current.languages.map((l) => (
              <button
                key={l.language}
                onClick={() => onLangChange(activeLang === l.language ? undefined : l.language)}
                className={`chip ${activeLang === l.language ? 'chip-active' : ''}`}
              >
                {l.language}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasMultiAudioTracks && onAudioTrackChange && (
        <div className="pt-3 border-t border-line">
          <div className="text-xs text-muted mb-2 uppercase tracking-wide">Audio Track</div>
          <div className="flex flex-wrap gap-2">
            {audioTracks.map((t) => (
              <button
                key={t.index}
                onClick={() => onAudioTrackChange(t.index)}
                className={`chip ${(audioTrackIndex ?? 0) === t.index ? 'chip-active' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasManifestAudio && onAudioLangChange && (
        <div className="pt-3 border-t border-line">
          <div className="text-xs text-muted mb-2 uppercase tracking-wide">Audio Language</div>
          <div className="flex flex-wrap gap-2">
            {audioLanguages.map((a) => (
              <button
                key={a.code}
                onClick={() => onAudioLangChange(a.code)}
                className={`chip ${(activeAudioLang ?? audioLanguages[0].code) === a.code ? 'chip-active' : ''}`}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {subtitles.length > 0 && onSubtitleChange && (
        <div className="pt-3 border-t border-line">
          <div className="text-xs text-muted mb-2 uppercase tracking-wide">Subtitles</div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onSubtitleChange(null)}
              className={`chip ${activeSubtitleIndex == null ? 'chip-active' : ''}`}
            >
              Off
            </button>
            {subtitles.map((s, i) => (
              <button
                key={s.url}
                onClick={() => onSubtitleChange(i)}
                className={`chip ${activeSubtitleIndex === i ? 'chip-active' : ''}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {stream && (
        <div className="pt-3 border-t border-line text-xs text-muted flex flex-wrap gap-3">
          {stream.host && <span>Host: {stream.host}</span>}
          {stream.source_type && <span>Type: {stream.source_type.toUpperCase()}</span>}
          {stream.selected_audio && <span>HLS audio: {stream.selected_audio}</span>}
        </div>
      )}
    </div>
  );
}