import type { Cue, Edit, Narration, Sfx, Shot } from "../edit";
import { wordAt } from "../timing";
import { LINES, SCRIPT } from "./script";
import { narrate, narrationDurations } from "./voice";

// 计时样带：字卡是真的，录屏镜头先用占位画面，字幕按语速估时间。
// 拿到真实录屏和配音后，用 full.ts 换掉占位

export const PRESET = "演示账号 · 学习记录为预置";
// 镜头 7 的“过一段时间”是把演示学生的记录整体往前挪 24 小时模拟的
export const LATER = "模拟一段时间后（预置数据）";
export const PAGE = { height: 720, scale: 1, width: 1280, x: 0, y: 0 };

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

// 开场动画（components/story.tsx）：三段配音 s1a、s1b、s1c 加 s2 都在一张字卡里，
// 中间按配音算好各个动作的时刻。s1b 念完先停一下音乐出“然后呢？”，再把 AI 拿走。
// 60 秒版不要 s2（question: false），盖完章就切
export function story({ question = true } = {}): Shot {
  let at = 0.35;
  const said: { cues: Cue[]; end: number; narration?: Narration }[] = [];
  const say = (id: string, gapBefore: number) => {
    const s = LINES.find((x) => x.id === id);
    if (!s) {
      throw new Error(id);
    }
    at += gapBefore;
    const r = narrate(id, s.narration, at);
    said.push(r);
    at = r.end;
    return r;
  };
  const word = (r: { cues: Cue[] }, w: string, fallback: number) =>
    wordAt(r.cues, w) ?? fallback;

  const v1 = say("s1a", 0);
  const ok1 = word(v1, "一看就懂", 1) + 0.3;
  const ok2 = ok1 + 0.6;
  const ok3 = Math.max(ok2 + 0.5, word(v1, "以为自己会了", ok2) + 0.2);

  const v2 = say("s1b", 0.3);
  const chartIn = v2.cues[0].start - 0.2;
  // 柱子落到头的时刻对着念到数字（按字数估的时刻比实际念到早 0.2–0.3 秒，往后挪一点）；
  // 从念到“用 AI 练习”“考试”开始长
  const LATE = 0.25;
  const bar1 = word(v2, "48%", chartIn + 3) + LATE;
  const bar1From = Math.min(bar1 - 0.8, word(v2, "用 AI 练习", bar1 - 1.5));

  const what = v2.end + 0.2;
  const yank = what + 1;
  const v3 = say("s1c", yank + 0.45 - v2.end);
  const bar2 = word(v3, "17%", yank + 3) + LATE + 0.05;
  const bar2From = Math.min(bar2 - 0.8, word(v3, "考试", bar2 - 1.5));

  const stamp = v3.end + 0.1;
  const v4 = question ? say("s2", stamp + 0.7 - v3.end) : undefined;
  const never = Number.POSITIVE_INFINITY;
  const words = v4 ? word(v4, "分不清", v4.end - 3) - 0.1 : never;
  const understood = v4 ? word(v4, "看懂了", words + 1) - 0.1 : never;
  const mastered = v4 ? word(v4, "真会了", understood + 1) + 0.3 : never;

  const sfx: Sfx[] = [
    ...[ok1, ok2, ok3].map((t) => ({ file: "sfx/pop.wav", t, volume: 0.5 })),
    { file: "sfx/thud.wav", t: bar1, volume: 0.3 },
    { file: "sfx/whoosh.wav", t: yank - 0.1, volume: 0.6 },
    { file: "sfx/thud.wav", t: bar2, volume: 0.65 },
    { file: "sfx/thud.wav", t: stamp + 0.12, volume: 0.45 },
    { file: "sfx/click.wav", t: stamp + 0.12, volume: 0.5 },
    ...(v4
      ? [
          { file: "sfx/chime-half.wav", t: understood + 0.15, volume: 0.3 },
          { file: "sfx/pop.wav", t: mastered + 0.1, volume: 0.4 },
        ]
      : []),
  ];
  const [first, ...rest] = said.flatMap((r) =>
    r.narration ? [r.narration] : []
  );
  return {
    beats: {
      bar1,
      bar1From,
      bar2,
      bar2From,
      bar3: v4 ? v4.cues[0].start + 0.2 : never,
      chartIn,
      mastered,
      ok1,
      ok2,
      ok3,
      stamp,
      // AI 的回答一下子刷满（讲得“太顺”）
      stream0: 0.1,
      stream1: Math.min(v1.end - 0.3, 1.9),
      understood,
      what,
      words,
      yank,
    },
    card: "story",
    cues: said.flatMap((r) => r.cues),
    duration: v4 ? v4.end + 0.5 : stamp + 1.4,
    id: "s1",
    kind: "card",
    mute: [[what - 0.05, yank + 0.2]],
    narration: first,
    sfx,
    title: "开场",
    voices: rest,
  };
}

export const opening = story();

const end = SCRIPT.find((x) => x.id === "s8");
const endCues = narrate("s8", end?.narration ?? "", 0.3);

// 收尾字卡（60 秒版也用这一张）
export const endCard: Shot = {
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
};

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
  endCard,
];

export const animatic: Edit = {
  fps: 60,
  height: 1080,
  narrationDurations,
  shots: [
    opening,
    screen("s3", { badge: PRESET }),
    screen("s4", { badge: PRESET }),
    screen("s5", { badge: PRESET }),
    screen("s6", { badge: PRESET }),
    screen("s7", { badge: LATER }),
    ...ending,
  ],
  width: 1920,
};
