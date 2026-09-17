import type { Server, StreamData } from '../api/types';
import { Badge } from './ui/Badge';

interface Props {
  servers: Server[];
  activeServer: number;
  activeLang?: string;
  activeQuality: number;
  stream: StreamData | null;
  onServerChange: (i: number) => void;
  onLangChange: (lang?: string) => void;
  onQualityChange: (i: number) => void;
}

export function ServerControls({
  servers,
  activeServer,
  activeLang,
  activeQuality,
  stream,
  onServerChange,
  onLangChange,
  onQualityChange,
}: Props) {
  const current = servers[activeServer];
  const hasLangs = current?.isMultiLang && current.languages.length > 0;
  const qualities = stream?.qualities;
  const hasMultiQuality = qualities && qualities.length > 1;

  return (
    <div className="bg-card rounded-xl p-4 space-y-3">
      {/* Servers */}
      <div>
        <div className="text-xs text-muted mb-2 uppercase tracking-wide">Server</div>
        <div className="flex flex-wrap gap-2">
          {servers.map((s, i) => (
            <Badge
              key={i}
              active={i === activeServer}
              onClick={() => onServerChange(i)}
            >
              {s.serverName}
              {s.isMultiLang && <span className="ml-1">🌐</span>}
            </Badge>
          ))}
        </div>
      </div>

      {/* Languages */}
      {hasLangs && (
        <div className="pt-3 border-t border-border">
          <div className="text-xs text-muted mb-2 uppercase tracking-wide">Audio</div>
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

      {/* Qualities */}
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
                  <span className="ml-1 text-muted">
                    ({Math.round(q.size / (1024 * 1024))}MB)
                  </span>
                )}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Stream info */}
      {stream && (
        <div className="pt-3 border-t border-border text-xs text-muted flex flex-wrap gap-3">
          {stream.host && <span>Host: {stream.host}</span>}
          {stream.source_type && <span>Type: {stream.source_type.toUpperCase()}</span>}
          {stream.selectedLanguage && <span>Audio: {stream.selectedLanguage}</span>}
          <span className="opacity-60">via media proxy</span>
        </div>
      )}
    </div>
  );
}