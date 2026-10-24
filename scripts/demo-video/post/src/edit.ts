import { countChars } from "./timing";

// 剪辑单：整部片子由一串镜头组成，每个镜头要么是字卡，要么是一段录屏。
// 时间单位都是秒。录屏里的坐标是网页的 CSS 像素（窗口内容 1280×720）。

export type Cue = {
  // 镜头内的成片时间
  start: number;
  end: number;
  text: string;
  // 操作在底部输入框时字幕挪到上面，不挡正在打的字
  position?: "top" | "bottom";
};

// 录屏里的一段：from–to 是素材时间，rate>1 表示加速（画面上会标“已加速”）
export type Clip = { from: number; to: number; rate?: number };

// 镜头从 t（素材时间）开始移向这个目标，用 dur 秒（素材秒，加速段里按倍数放大）到位；画面上换成成片时间走（cameraKeysOut）
export type CameraKey = {
  t: number;
  x: number;
  y: number;
  zoom: number;
  dur?: number;
};

export type CursorKey = { t: number; x: number; y: number };
export type Click = { t: number; x: number; y: number };

export type Badge = {
  text: string;
  // 镜头内的成片时间，不写就整镜都挂着
  from?: number;
  to?: number;
};

export type Sfx = {
  // 镜头内的成片时间
  t: number;
  file: string;
  volume?: number;
};

export type Narration = {
  file: string;
  // 镜头内从第几秒开始念
  start: number;
};

export type Viewport = {
  // 素材画面多大（素材像素）
  width: number;
  height: number;
  // 网页内容左上角在素材画面里的位置（素材像素）；scale = 每个 CSS 像素占几个素材像素（Retina 是 2）
  x: number;
  y: number;
  scale: number;
};

export type ScreenShot = {
  kind: "screen";
  id: string;
  title: string;
  // public/ 下的素材路径；null 时画一个占位画面（计时样带用）
  footage: string | null;
  placeholder?: string;
  viewport: Viewport;
  clips: Clip[];
  camera: CameraKey[];
  cursor: CursorKey[];
  clicks: Click[];
  cues: Cue[];
  badges?: Badge[];
  // 开头叠一张 Dr.Turing 标题卡再淡出（镜头 3）
  intro?: boolean;
  narration?: Narration;
  sfx?: Sfx[];
};

export type CardKind = "pain" | "gap" | "pilot" | "end";

export type CardShot = {
  kind: "card";
  id: string;
  title: string;
  card: CardKind;
  duration: number;
  // 字卡上各元素出现的时刻（镜头内秒数），对着配音调
  beats?: Record<string, number>;
  cues: Cue[];
  narration?: Narration;
  sfx?: Sfx[];
};

export type Shot = ScreenShot | CardShot;

export type Music = {
  file: string;
  // 没人说话时的音量（0–1）
  volume: number;
  // 说话时再压低多少分贝
  duckDb: number;
};

export type Edit = {
  fps: number;
  width: number;
  height: number;
  shots: Shot[];
  music?: Music;
  // 每段配音的时长（秒），由 measure 脚本量好写进来；算压低音乐用
  narrationDurations?: Record<string, number>;
};

export const VIEW_W = 1280;
export const VIEW_H = 720;

// 录屏装进成片中间的一个“窗口”，上面留一条放角标、下面留一条放字幕，都不挡网页上的按钮。
// 1920×1080 成片：窗口 1536×864（网页的 1.2 倍），离上边 64、离下边 152
export function windowRect(width: number, height: number) {
  const w = Math.round(width * 0.8);
  const h = Math.round((w * VIEW_H) / VIEW_W);
  return {
    h,
    w,
    x: Math.round((width - w) / 2),
    y: Math.round((height * 64) / 1080),
  };
}

export type LaidClip = Clip & {
  rate: number;
  outStart: number;
  outEnd: number;
};

export function layoutClips(clips: Clip[]): LaidClip[] {
  let t = 0;
  return clips.map((clip) => {
    const rate = clip.rate ?? 1;
    const outStart = t;
    t += (clip.to - clip.from) / rate;
    return { ...clip, outEnd: t, outStart, rate };
  });
}

export function shotDuration(shot: Shot): number {
  if (shot.kind === "card") {
    return shot.duration;
  }
  const laid = layoutClips(shot.clips);
  return laid.at(-1)?.outEnd ?? 0;
}

// 成片时间 → 素材时间
export function sourceTime(laid: LaidClip[], out: number): number {
  if (laid.length === 0) {
    return out;
  }
  const clip =
    laid.find((c) => out >= c.outStart && out < c.outEnd) ?? laid.at(-1);
  if (!clip) {
    return out;
  }
  const local = Math.min(out, clip.outEnd) - clip.outStart;
  return clip.from + local * clip.rate;
}

// 素材时间 → 成片时间；落在剪掉部分的算到下一段开头
export function outputTime(laid: LaidClip[], src: number): number {
  for (const c of laid) {
    if (src < c.from) {
      return c.outStart;
    }
    if (src < c.to) {
      return c.outStart + (src - c.from) / c.rate;
    }
  }
  return laid.at(-1)?.outEnd ?? src;
}

// “已加速 ×N”角标显示的倍数：两段加速之间夹着不到 0.5 秒的原速，角标不熄（免得一闪一闪）
const BADGE_GAP = 0.5;

export function speedAt(laid: LaidClip[], out: number): number {
  const i = laid.findIndex((c) => out >= c.outStart && out < c.outEnd);
  const clip = laid[i];
  if (!clip) {
    return 1;
  }
  if (clip.rate > 1) {
    return clip.rate;
  }
  const prev = laid[i - 1];
  const next = laid[i + 1];
  return prev &&
    next &&
    prev.rate > 1 &&
    next.rate > 1 &&
    clip.outEnd - clip.outStart < BADGE_GAP
    ? prev.rate
    : 1;
}

const easeInOutCubic = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;

export type CameraState = { x: number; y: number; zoom: number };

export const HOME: CameraState = { x: VIEW_W / 2, y: VIEW_H / 2, zoom: 1 };

// 一个镜头键：从上一个状态平滑移到目标。缩放按对数插值，放大和缩小的速度感一样
function blend(a: CameraState, b: CameraState, p: number): CameraState {
  const e = easeInOutCubic(Math.min(1, Math.max(0, p)));
  return {
    x: a.x + (b.x - a.x) * e,
    y: a.y + (b.y - a.y) * e,
    zoom: Math.exp(
      Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * e
    ),
  };
}

// 放大后可见区域不能超出网页边界
export function clampCamera(c: CameraState): CameraState {
  const zoom = Math.max(1, c.zoom);
  const halfW = VIEW_W / zoom / 2;
  const halfH = VIEW_H / zoom / 2;
  return {
    x: Math.min(VIEW_W - halfW, Math.max(halfW, c.x)),
    y: Math.min(VIEW_H - halfH, Math.max(halfH, c.y)),
    zoom,
  };
}

const DEFAULT_DUR = 0.8;

// 镜头键换到成片时间，移动时长按键所在那一段的倍数换回成片秒。镜头在成片时间上走：
// 移动跨进后面的加速段或剪辑点也照样走满，不会一两帧就跳过去（停留结尾紧跟加速、剪辑时的“啪”一下）
export function cameraKeysOut(
  keys: CameraKey[],
  laid: LaidClip[]
): CameraKey[] {
  if (laid.length === 0) {
    return keys;
  }
  return keys.map((k) => {
    const clip =
      laid.find((c) => k.t >= c.from && k.t < c.to) ??
      laid.find((c) => c.from > k.t);
    return {
      ...k,
      dur: (k.dur ?? DEFAULT_DUR) / (clip?.rate ?? 1),
      t: outputTime(laid, k.t),
    };
  });
}

// 某一时刻的镜头（keys 和 t 用同一种时间：成片画面传 cameraKeysOut 换过的键和成片秒）
export function cameraAt(keys: CameraKey[], src: number): CameraState {
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  let state = HOME;
  for (let i = 0; i < sorted.length; i += 1) {
    const key = sorted[i];
    if (src < key.t) {
      break;
    }
    const dur = key.dur ?? DEFAULT_DUR;
    const next = sorted[i + 1];
    // 下一个键在这次移动没到位前就开始了：从移动到一半的位置接着走
    const until = next ? Math.min(src, next.t) : src;
    state = blend(state, key, dur > 0 ? (until - key.t) / dur : 1);
  }
  return clampCamera(state);
}

export function cursorAt(
  keys: CursorKey[],
  src: number
): { x: number; y: number } | null {
  if (keys.length === 0 || src < keys[0].t) {
    return null;
  }
  let lo = 0;
  let hi = keys.length - 1;
  if (src >= keys[hi].t) {
    return { x: keys[hi].x, y: keys[hi].y };
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= src) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const a = keys[lo];
  const b = keys[hi];
  const p = b.t === a.t ? 1 : (src - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
}

// 页面坐标 → 成片画面坐标（镜头放大后）
export function project(
  p: { x: number; y: number },
  cam: CameraState,
  width: number,
  height: number
) {
  const base = width / VIEW_W;
  const s = base * cam.zoom;
  return {
    s,
    x: (p.x - cam.x) * s + width / 2,
    y: (p.y - cam.y) * s + height / 2,
  };
}

// 字幕规范：一行不超过 16 字，每秒不超过 9 字；句中逗号句号换成空格
export function subtitleText(text: string): string {
  return text
    .replace(/[，。、；：]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function checkCues(cues: Cue[]): string[] {
  const problems: string[] = [];
  for (const cue of cues) {
    const text = subtitleText(cue.text);
    const lines = text.split("\n");
    const chars = countChars(text);
    for (const line of lines) {
      if (countChars(line) > 16) {
        problems.push(`一行超过 16 字：${line}`);
      }
    }
    const secs = cue.end - cue.start;
    if (secs <= 0) {
      problems.push(`时长不对：${cue.text}`);
    } else if (chars / secs > 9) {
      problems.push(
        `每秒 ${(chars / secs).toFixed(1)} 字，超过 9：${cue.text}`
      );
    }
  }
  return problems;
}
