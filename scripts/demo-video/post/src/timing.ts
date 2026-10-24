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
