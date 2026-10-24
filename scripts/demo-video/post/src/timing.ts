import type { Cue } from "./edit";

// 还没有配音时，按语速估出每句字幕的时间（计时样带用）；有了配音后改用配音的时间戳
const PAUSE: Record<string, number> = {
  "。": 0.45,
  "，": 0.2,
  "：": 0.25,
  "；": 0.3,
  "？": 0.45,
};

// 字幕宽度：汉字算 1，英文字母和数字算半个
export const countChars = (s: string) =>
  [...s.replace(/[\s，。：；？]/g, "")].reduce(
    (n, ch) => n + (/[\x21-\x7e]/.test(ch) ? 0.5 : 1),
    0
  );

// 按标点切成短句，再把短句拼成一行不超过 16 字的字幕
export function phrases(text: string, maxChars = 16): string[] {
  const parts = text.match(/[^，。：；？]+[，。：；？]?/g) ?? [text];
  const lines: string[] = [];
  let line = "";
  for (const part of parts) {
    const merged = line + part;
    if (line && countChars(merged) > maxChars) {
      lines.push(line);
      line = part;
    } else {
      line = merged;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines.map((l) => l.trim());
}

export function autoCues(
  text: string,
  start: number,
  charsPerSecond = 4.2
): { cues: Cue[]; end: number } {
  let t = start;
  const cues: Cue[] = [];
  for (const line of phrases(text)) {
    const speak = countChars(line) / charsPerSecond;
    const pause = PAUSE[line.at(-1) ?? ""] ?? 0;
    cues.push({ end: t + speak, start: t, text: line });
    t += speak + pause;
  }
  return { cues, end: t };
}

// 有了配音后，把相邻两句字幕的分界挪到配音里最近的停顿上（按字数估的分界会早或晚半秒）。
// pauses 是配音里的静音段（相对配音开头的秒数）；停顿短于 LINGER 秒时两句字幕直接接上，长停顿里留一小段空白
const SNAP = 0.9;
const LINGER = 0.6;

export function snapCues(
  cues: Cue[],
  pauses: [number, number][],
  start: number
): Cue[] {
  const out = cues.map((c) => ({ ...c }));
  let from = 0;
  for (let i = 1; i < out.length; i += 1) {
    const b = out[i].start - start;
    let best = -1;
    let bestDist = SNAP;
    for (let j = from; j < pauses.length; j += 1) {
      const [a, z] = pauses[j];
      const dist = b < a ? a - b : b > z ? b - z : 0;
      if (
        dist < bestDist ||
        (dist === bestDist &&
          best >= 0 &&
          z - a > pauses[best][1] - pauses[best][0])
      ) {
        best = j;
        bestDist = dist;
      }
    }
    if (best < 0) {
      continue;
    }
    const [a, z] = pauses[best];
    const next = start + Math.max(a, z - 0.1);
    // 挪过头（比上一句开头还早）就不挪
    if (next < out[i - 1].start + 0.5) {
      continue;
    }
    from = best + 1;
    out[i].start = next;
    out[i - 1].end = z - a < LINGER ? next : start + a + 0.25;
  }
  return out;
}
