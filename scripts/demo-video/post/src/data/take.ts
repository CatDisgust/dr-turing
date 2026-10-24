import type {
  CameraKey,
  Click,
  Clip,
  CursorKey,
  Edit,
  Shot,
  Viewport,
} from "../edit";
import { autoCues } from "../timing";
import { ending, gap, NEXT_DAY, PAGE, PRESET, pain } from "./animatic";
import { SCRIPT } from "./script";
import TAKE from "./take.json";

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
  viewport: Viewport | null;
  stats: { raw: number; edited: number };
};

export type Take = {
  take: string | null;
  // public/ 下的素材路径；null 时用占位画面
  footage: string | null;
  shots: DraftShot[];
};

const FPS = 60;
// 讲稿念完后至少再留这么久画面
const TAIL = 0.6;

// 讲稿比画面长时，在最后一帧停住补够（计时样带用，正式剪辑再细调）
export function padClips(clips: Clip[], need: number): Clip[] {
  const have = clips.reduce((n, c) => n + (c.to - c.from) / (c.rate ?? 1), 0);
  const last = clips.at(-1);
  if (!last || need <= have + 0.01) {
    return clips;
  }
  const frame = 1 / FPS;
  return [
    ...clips,
    {
      from: last.to - frame,
      rate: frame / (need - have),
      to: last.to,
    },
  ];
}

function screenShot(take: Take, draft: DraftShot): Shot {
  const id = `s${draft.shot}`;
  const s = SCRIPT.find((x) => x.id === id);
  if (!s) {
    throw new Error(`讲稿里没有 ${id}`);
  }
  const intro = draft.shot === 3;
  const { cues, end } = autoCues(s.narration, intro ? 1.9 : 0.5);
  return {
    badges: [{ text: draft.shot === 7 ? NEXT_DAY : PRESET }],
    camera: draft.camera,
    clicks: draft.clicks ?? [],
    clips: padClips(draft.clips, end + TAIL),
    cues,
    cursor: draft.cursor ?? [],
    footage: take.footage,
    id,
    intro,
    kind: "screen",
    placeholder: s.picture,
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
    shots: [pain, gap, ...shots, ...ending],
    width: 1920,
  };
}

export const currentTake = TAKE as Take;
export const fromTake = takeEdit(currentTake);
