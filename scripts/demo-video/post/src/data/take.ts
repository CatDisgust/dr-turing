import {
  type CameraKey,
  type Click,
  type Clip,
  type CursorKey,
  type Edit,
  layoutClips,
  outputTime,
  type Sfx,
  type Shot,
  type Viewport,
} from "../edit";
import { ending, gap, NEXT_DAY, PAGE, PRESET, pain } from "./animatic";
import { SCRIPT } from "./script";
import TAKE from "./take.json";
import { narrate, narrationDurations } from "./voice";

// 用一条真实录制出的计时样带：录屏镜头的片段、加速、镜头放大、光标都来自那条 take 的剪辑单草稿
// （scripts/demo-video/draft.mjs），字卡和讲稿同计时样带。素材在 public/ 下就用真画面，没有就用占位画面。
// 换 take：node scripts/use-take.mjs ../out/<take>

export type DraftShot = {
  shot: number;
  window: { start: number; end: number };
  clips: Clip[];
  camera: CameraKey[];
  cursor?: CursorKey[];
  clicks?: Click[];
  holds?: { t: number; label?: string; ms?: number }[];
  viewport: Viewport | null;
  stats: { raw: number; edited: number };
};

export type Take = {
  take: string | null;
  // public/ 下的素材路径；null 时用占位画面
  footage: string | null;
  // use-take 写好了 public/sfx/ 的音效、public/music/bed.wav 的背景音乐
  sfx?: boolean;
  music?: boolean;
  shots: DraftShot[];
};

const FPS = 60;
// 讲稿念完后至少再留这么久画面
const TAIL = 0.6;

// 讲稿比画面长时先把加速段放慢（倍数最低到 1），还不够再在最后一帧停住补够（计时样带用，正式剪辑再细调）
export function fitClips(clips: Clip[], need: number): Clip[] {
  const len = (c: Clip) => (c.to - c.from) / (c.rate ?? 1);
  let out = clips.map((c) => ({ ...c }));
  for (let i = 0; i < 4; i += 1) {
    const have = out.reduce((n, c) => n + len(c), 0);
    const sped = out.filter((c) => (c.rate ?? 1) > 1);
    const spedLen = sped.reduce((n, c) => n + len(c), 0);
    if (need <= have + 0.01 || sped.length === 0) {
      break;
    }
    const f = (spedLen + need - have) / spedLen;
    out = out.map((c) => {
      if ((c.rate ?? 1) <= 1) {
        return c;
      }
      const rate = Math.round(((c.rate ?? 1) / f) * 10) / 10;
      return rate > 1.05 ? { ...c, rate } : { from: c.from, to: c.to };
    });
  }
  const have = out.reduce((n, c) => n + len(c), 0);
  const last = out.at(-1);
  if (!last || need <= have + 0.01) {
    return out;
  }
  const frame = 1 / FPS;
  return [
    ...out,
    {
      from: last.to - frame,
      rate: frame / (need - have),
      to: last.to,
    },
  ];
}

// 音效：点击只在原速、2 倍以内的片段里响（快放时一串咔哒反而吵）；「死锁」半亮、全亮时镜头到了星上响一声
// （停留标记是鼠标到星旁边的时刻，镜头还要再推约 0.35 秒才停稳）
const CLICK_RATE = 2;
const CHIME_DELAY = 0.35;
const CHIMES: [RegExp, string][] = [
  [/「死锁」全亮/, "sfx/chime-full.wav"],
  [/「死锁」半亮/, "sfx/chime-half.wav"],
];

// 背景音乐（scripts/music.mjs 合成）：没人说话时约 -24 LUFS，说话时再压低 9 分贝（配音 -16 LUFS）
const MUSIC = { duckDb: 9, file: "music/bed.wav", volume: 0.35 };

export function shotSfx(draft: DraftShot, clips: Clip[]): Sfx[] {
  const laid = layoutClips(clips);
  const clipAt = (t: number) => laid.find((c) => t >= c.from && t < c.to);
  const at = (t: number) => Math.round(outputTime(laid, t) * 1000) / 1000;
  const out: Sfx[] = [];
  for (const c of draft.clicks ?? []) {
    const clip = clipAt(c.t);
    if (clip && clip.rate <= CLICK_RATE) {
      out.push({ file: "sfx/click.wav", t: at(c.t), volume: 0.6 });
    }
  }
  for (const h of draft.holds ?? []) {
    const file = CHIMES.find(([re]) => re.test(h.label ?? ""))?.[1];
    if (file && clipAt(h.t)) {
      out.push({ file, t: at(h.t) + CHIME_DELAY, volume: 0.45 });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

function screenShot(take: Take, draft: DraftShot): Shot {
  const id = `s${draft.shot}`;
  const s = SCRIPT.find((x) => x.id === id);
  if (!s) {
    throw new Error(`讲稿里没有 ${id}`);
  }
  const intro = draft.shot === 3;
  const { cues, end, narration } = narrate(id, s.narration, intro ? 1.9 : 0.5);
  const clips = fitClips(draft.clips, end + TAIL);
  return {
    badges: [{ text: draft.shot === 7 ? NEXT_DAY : PRESET }],
    camera: draft.camera,
    clicks: draft.clicks ?? [],
    clips,
    cues,
    cursor: draft.cursor ?? [],
    footage: take.footage,
    id,
    intro,
    kind: "screen",
    narration,
    placeholder: s.picture,
    sfx: take.sfx && take.footage ? shotSfx(draft, clips) : [],
    title: s.title,
    viewport: take.footage ? (draft.viewport ?? PAGE) : PAGE,
  };
}

export function takeEdit(take: Take): Edit | null {
  if (!take.take || take.shots.length === 0) {
    return null;
  }
  const shots = take.shots
    .filter((d) => d.shot >= 3 && d.shot <= 7)
    .toSorted((a, b) => a.shot - b.shot)
    .map((d) => screenShot(take, d));
  return {
    fps: FPS,
    height: 1080,
    music: take.music ? MUSIC : undefined,
    narrationDurations,
    shots: [pain, gap, ...shots, ...ending],
    width: 1920,
  };
}

export const currentTake = TAKE as Take;
export const fromTake = takeEdit(currentTake);
