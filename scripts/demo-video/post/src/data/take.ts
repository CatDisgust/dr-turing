import {
  type CameraKey,
  type Click,
  type Clip,
  type CursorKey,
  cameraAt,
  type Edit,
  HOME,
  layoutClips,
  outputTime,
  type Sfx,
  type Shot,
  shotDuration,
  type Viewport,
} from "../edit";
import {
  endCard,
  ending,
  gap,
  LATER,
  PAGE,
  PRESET,
  pain,
  painCard,
} from "./animatic";
import { LINES } from "./script";
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
// 「以为学会了」那条红条：一声低沉的下行两音
const CHIMES: [RegExp, string][] = [
  [/「死锁」全亮/, "sfx/chime-full.wav"],
  [/「死锁」半亮/, "sfx/chime-half.wav"],
  [/以为学会了/, "sfx/low.wav"],
];

// 背景音乐（scripts/music.mjs 合成，bed.wav 约 -19 LUFS）：没人说话时约 -24 LUFS，
// 说话时再压低 12 分贝，比配音（-16 LUFS）低 20 分贝；「死锁」全亮起叠上抬起层 lift.wav
const MUSIC = { duckDb: 12, file: "music/bed.wav", volume: 0.57 };
const LIFT = "music/lift.wav";
const CHIME_FULL = "sfx/chime-full.wav";

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

// 60 秒版只留素材里几个时间窗：剪辑单片段按窗口截取（加速倍数不变）
export function clipWindows(
  clips: Clip[],
  windows: [number, number][]
): Clip[] {
  return windows.flatMap(([a, b]) =>
    clips.flatMap((c) => {
      const from = Math.max(c.from, a);
      const to = Math.min(c.to, b);
      return to - from > 1 / FPS ? [{ ...c, from, to }] : [];
    })
  );
}

// 窗口之间是硬切：每个窗口开头把镜头直接放到那一刻该在的位置（不从上一个窗口滑过来），
// 只留窗口里的键；最后一个窗口结尾还放大着，就在结尾前 0.8 秒拉回全景（和完整版镜头结尾一样）
export function windowCamera(
  keys: CameraKey[],
  windows: [number, number][]
): CameraKey[] {
  const out: CameraKey[] = [];
  for (const [a, b] of windows) {
    out.push({ ...cameraAt(keys, a), dur: 0, t: a });
    out.push(...keys.filter((k) => k.t > a && k.t < b));
  }
  const end = windows.at(-1)?.[1];
  if (end !== undefined && cameraAt(out, end - 0.8).zoom > 1.01) {
    out.push({ ...HOME, dur: 0.8, t: end - 0.8 });
  }
  return out;
}

// 窗口用停留标记定位：label 匹配的那次停留的时刻 + offset 秒
function holdAt(draft: DraftShot, label: RegExp, offset = 0): number {
  const h = (draft.holds ?? []).find((x) => label.test(x.label ?? ""));
  if (!h) {
    throw new Error(`镜头 ${draft.shot} 里没有停留「${label.source}」`);
  }
  return h.t + offset;
}

function screenShot(
  take: Take,
  draft: DraftShot,
  {
    id = `s${draft.shot}`,
    windows,
  }: { id?: string; windows?: [number, number][] } = {}
): Shot {
  const s = LINES.find((x) => x.id === id);
  if (!s) {
    throw new Error(`讲稿里没有 ${id}`);
  }
  const intro = draft.shot === 3;
  const { cues, end, narration } = narrate(id, s.narration, intro ? 1.9 : 0.5);
  const picked = windows ? clipWindows(draft.clips, windows) : draft.clips;
  const clips = fitClips(picked, end + TAIL);
  return {
    badges: [{ text: draft.shot === 7 ? LATER : PRESET }],
    camera: windows ? windowCamera(draft.camera, windows) : draft.camera,
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
  const all = [pain, gap, ...shots, ...ending];
  return {
    fps: FPS,
    height: 1080,
    music: take.music
      ? { ...MUSIC, lift: { at: liftAt(all), file: LIFT } }
      : undefined,
    narrationDurations,
    shots: all,
    width: 1920,
  };
}

// 抬起层从「死锁」全亮那一声开始；没有这一声就从片尾字卡开始
function liftAt(shots: Shot[]): number {
  let t = 0;
  for (const s of shots) {
    const full =
      s.kind === "screen"
        ? s.sfx?.find((x) => x.file === CHIME_FULL)
        : undefined;
    if (full) {
      return t + full.t;
    }
    t += shotDuration(s);
  }
  return (
    t -
    shots
      .filter((s) => s.kind === "card")
      .slice(-2)
      .reduce((n, s) => n + shotDuration(s), 0)
  );
}

// 60 秒版：痛点字卡 → 星图（镜头 3 全段）→ 很确定却答错、独立答对半亮（镜头 5 两个时间窗）
// → 过一段时间答对全亮（镜头 7 到全亮为止）→ 收尾字卡
export function shortEdit(take: Take): Edit | null {
  const full = takeEdit(take);
  const draft = (n: number) => take.shots.find((d) => d.shot === n);
  const [d3, d5, d7] = [draft(3), draft(5), draft(7)];
  if (!(full && d3 && d5 && d7)) {
    return null;
  }
  const shots = [
    painCard("m1"),
    screenShot(take, d3, { id: "m2" }),
    screenShot(take, d5, {
      id: "m3",
      windows: [
        [d5.window.start, holdAt(d5, /以为学会了/, 2.5)],
        [holdAt(d5, /独立答对/, -0.6), holdAt(d5, /「死锁」半亮/, 3)],
      ],
    }),
    screenShot(take, d7, {
      id: "m4",
      windows: [[d7.window.start, holdAt(d7, /「死锁」全亮/, 3)]],
    }),
    endCard,
  ];
  return {
    ...full,
    music: full.music
      ? { ...full.music, lift: { at: liftAt(shots), file: LIFT } }
      : undefined,
    shots,
  };
}

export const currentTake = TAKE as Take;
export const fromTake = takeEdit(currentTake);
export const shortFromTake = shortEdit(currentTake);
