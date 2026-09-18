export interface VttCue {
  start: number;
  end: number;
  text: string;
}

function tsToSeconds(ts: string): number {
  const parts = ts.trim().split(':');
  const [h, m, s] = parts.length === 3 ? parts : ['0', parts[0], parts[1]];
  const [sec, ms] = s.split('.');
  return (
    Number(h) * 3600 +
    Number(m) * 60 +
    Number(sec) +
    (ms ? Number(ms.padEnd(3, '0')) / 1000 : 0)
  );
}

export function parseVtt(vtt: string): VttCue[] {
  const cues: VttCue[] = [];
  const blocks = vtt.replace(/\r+/g, '').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    if (/^(WEBVTT|NOTE|STYLE|REGION)/.test(lines[0])) continue;
    let idx = 0;
    if (!lines[0].includes('-->')) idx = 1; // skip cue identifier
    const timeLine = lines[idx];
    if (!timeLine || !timeLine.includes('-->')) continue;
    const [startStr, endStr] = timeLine.split('-->');
    const start = tsToSeconds(startStr.trim().split(/\s/)[0]);
    const end = tsToSeconds(endStr.trim().split(/\s/)[0]);
    const text = lines
      .slice(idx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')                       // strip inline tags
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/^\\-/gm, '-')                        // FirePlayer escaped dashes
      .trim();
    if (text) cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}