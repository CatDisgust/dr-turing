import type { Cue, Narration } from "../edit";
import { autoCues, snapCues } from "../timing";
import VOICE from "./voice.json";

// 配音：每个镜头一段（public/voice/<id>.wav），时长由 scripts/temp-voice.mjs 量好写进 voice.json。
// 有配音时字幕按配音实际时长摊开、分界挪到配音的停顿上，镜头至少等配音念完；没有就按语速估（计时样带）

// pauses：配音里的停顿（秒，相对这段开头），由 measure 脚本用 ffmpeg silencedetect 量出来
export type VoiceFile = {
  file: string;
  duration: number;
  pauses?: [number, number][];
};
export type Voice = {
  // 用的是哪个声音；null 表示还没有配音
  voice: string | null;
  files: Record<string, VoiceFile>;
};

export const voice = VOICE as Voice;

export function narrate(
  id: string,
  text: string,
  start: number
): { cues: Cue[]; end: number; narration?: Narration } {
  const est = autoCues(text, start);
  const v = voice.files[id];
  if (!v || est.end <= start) {
    return est;
  }
  const k = v.duration / (est.end - start);
  const at = (t: number) => start + (t - start) * k;
  const scaled = est.cues.map((c) => ({
    ...c,
    end: at(c.end),
    start: at(c.start),
  }));
  return {
    cues: snapCues(scaled, v.pauses ?? [], start),
    end: start + v.duration,
    narration: { file: v.file, start },
  };
}

// 音乐压低要知道每段配音多长
export const narrationDurations = Object.fromEntries(
  Object.values(voice.files).map((v) => [v.file, v.duration])
);
