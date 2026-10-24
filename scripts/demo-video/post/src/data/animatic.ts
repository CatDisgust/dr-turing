import type { Edit, Shot } from "../edit";
import { SCRIPT } from "./script";
import { narrate, narrationDurations } from "./voice";

// 计时样带：字卡是真的，录屏镜头先用占位画面，字幕按语速估时间。
// 拿到真实录屏和配音后，用 full.ts 换掉占位

export const PRESET = "演示账号 · 学习记录为预置";
export const NEXT_DAY = "模拟第二天（预置数据）";
export const PAGE = { height: 720, scale: 1, width: 1280, x: 0, y: 0 };

export function card(
  id: string,
  kind: "pain" | "gap",
  narrationStart = 0.4
): Shot {
  const s = SCRIPT.find((x) => x.id === id);
  if (!s) {
    throw new Error(id);
  }
  const { cues, end, narration } = narrate(id, s.narration, narrationStart);
  return {
    card: kind,
    cues,
    // 有配音就跟着配音走；没有就至少占分镜给的时长
    duration: narration ? end + 0.8 : Math.max(s.slot, end + 0.8),
    id,
    kind: "card",
    narration,
    title: s.title,
  };
}

function screen(
  id: string,
  opts: { intro?: boolean; badge?: string } = {}
): Shot {
  const s = SCRIPT.find((x) => x.id === id);
  if (!s) {
    throw new Error(id);
  }
  const start = opts.intro ? 1.9 : 0.5;
  const { cues, end, narration } = narrate(id, s.narration, start);
  const duration = Math.max(s.slot, end + 1);
  return {
    badges: opts.badge ? [{ text: opts.badge }] : [],
    camera: [],
    clicks: [],
    clips: [{ from: 0, to: duration }],
    cues,
    cursor: [],
    footage: null,
    id,
    intro: opts.intro,
    kind: "screen",
    narration,
    placeholder: s.picture,
    title: s.title,
    viewport: PAGE,
  };
}

export const pain = card("s1", "pain");
// 两个数字跟着配音出现：“用 AI 练习时成绩高了 48%”“拿掉 AI，考试反而低了 17%”
if (pain.kind === "card") {
  const at = (needle: string) =>
    pain.cues.find((c) => c.text.includes(needle))?.start ?? 0;
  pain.beats = { exam: at("拿掉"), practice: at("用 AI 练习") };
}

export const gap = card("s2", "gap");
if (gap.kind === "card") {
  gap.beats = {
    line2: gap.cues.find((c) => c.text.includes("但"))?.start ?? 4,
  };
}

const end = SCRIPT.find((x) => x.id === "s8");
const endCues = narrate("s8", end?.narration ?? "", 0.3);

// 结尾：试点计划字卡（无配音）+ 收尾字卡
export const ending: Shot[] = [
  {
    card: "pilot",
    cues: [],
    duration: 3,
    id: "s8a",
    kind: "card",
    title: "试点计划",
  },
  {
    beats: {
      line2: endCues.cues.find((c) => c.text.includes("Dr.Turing"))?.start ?? 2,
    },
    card: "end",
    // 收尾字卡上的字就是配音原话，不再叠字幕
    cues: [],
    duration: Math.max(7, endCues.end + 3),
    id: "s8b",
    kind: "card",
    narration: endCues.narration,
    title: "收尾",
  },
];

export const animatic: Edit = {
  fps: 60,
  height: 1080,
  narrationDurations,
  shots: [
    pain,
    gap,
    screen("s3", { badge: PRESET, intro: true }),
    screen("s4", { badge: PRESET }),
    screen("s5", { badge: PRESET }),
    screen("s6", { badge: PRESET }),
    screen("s7", { badge: NEXT_DAY }),
    ...ending,
  ],
  width: 1920,
};
