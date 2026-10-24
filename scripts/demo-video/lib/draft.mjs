// 一条录好的 take（aligned.json）→ 每个镜头的剪辑单草稿：取哪段素材、哪里加速、镜头往哪放大、光标和点击。
// 输出的字段就是 post/src/edit.ts 里 ScreenShot 的 footage / viewport / clips / camera / cursor / clicks，
// 计时样带和样片直接拿来用，再手工微调。纯函数，test/draft.test.mjs 有单测；draft.mjs 负责读写文件。
// 时间都是素材秒，坐标是网页 CSS 像素（1280×720）

// 各种等待压到多长（秒），压不下的部分加速，画面自动标“已加速 ×N”。制作方案：等待一律剪掉或加速并标出来
//  think  导师思考中（只有等待动画）      → 不超过 0.8 秒
//  review 结束学习后的复核等待            → 不超过 0.8 秒
//  stream 导师出字                         → 不超过 2 秒，至少 3 倍
//  type   打字                             → 不超过 2.2 秒，最多 8 倍
//  repeat 快放的整轮（从点按钮到导师回完）→ 不超过 2 秒：镜头 5 的反例追问（分镜写明“加速”）、
//         第二道起的独立题、复习后再答、点“先不做题”
//  fold   收紧的镜头里整段快放（PACE.fold）：镜头 7 又聊哲学家就餐 → 结束学习 → 打开星图，每段不超过 1.5 秒
//  idle   画面上什么都没动（没光标、没点击、页面没变）超过 1.2 秒 → 不超过 0.6 秒
//  停留（hold：鼠标指着一处让观众看）原速，但最多留 2 秒（题目 2.4 秒、出处 3 秒、镜头 3 的星图全留），多的剪掉
//  第二次及以后的“结束本次学习”：小结镜头 6 已经演过，从小结弹出前到关掉小结整段剪掉
//  打开“我的星图”后星星还没画出来的那一下（空黑板）剪掉
//  空白帧（整个窗口一片白，align.mjs 量出来的）剪掉，前后各多剪一点
//  录制中用 page.screenshot 截图时 Chrome 会把窗口重画、1–5 帧大半是白的：截图标记前 0.16 秒到后 0.03 秒剪掉
const MAX_IDLE = 0.8;
const MIN_RATE = 2;
const STREAM_MAX = 2;
const STREAM_RATE = 3;
const TYPE_MAX = 2.2;
const TYPE_MAX_RATE = 8;
const REPEAT_MAX = 2;
const IDLE_GAP = 1.2;
const IDLE_MAX = 0.6;
const HOLD_MAX = 2;
const HOLD_LONGER = [
  [/星图/, 60],
  [/出处/, 3],
  [/检查题|复习题/, 2.4],
];

// 导师回复第一次露出内容时，页面上会出现的东西（任意一个出现就算思考结束）
const SHOWN_KEYS = new Set([
  "reply-shown",
  "plan",
  "start-from",
  "graded-line",
  "check-card",
  "deadlock-sim",
  "answer-bar",
  "session-report",
]);

// 镜头放大跟着“停留”走：鼠标停在哪就放大哪。小字关键处约 2 倍，大块内容约 1.4 倍（制作方案“镜头放大”一行）
const HOLD_ZOOM = [
  [/从你会的|以为学会了|独立答对|答对了|「死锁」/, 2],
  [/检查题|复习题|模拟卡死了|本次学习小结|出处|连线/, 1.4],
];
const TYPING_ZOOM = 1.4;
const SIM_ZOOM = 1.4;
// 对话列在网页 x 104–784：落在这一列里的放大，横向整列框进来、最多 1.75 倍（可见 731px 宽），左右不切字
const CHAT = { center: 444, maxZoom: 1.75, right: 830 };
const frameChat = (f) =>
  f.x < CHAT.right
    ? { ...f, x: CHAT.center, zoom: Math.min(f.zoom, CHAT.maxZoom) }
    : f;
// 镜头移动用多久（成片秒），加速段里按倍数换成素材秒，不会一闪而过
const CAMERA_DUR = 0.8;
// 空白帧前后各多剪多少秒（60 帧/秒时略多于一帧，取整后也盖得住）
const BLANK_PAD = 0.02;
// 截图闪白在截图标记前 30–130 毫秒开始、最长 5 帧（2026-10-24 那条 take 量的），标记记在截完之后
const SHOT_FLASH = { after: 0.03, before: 0.16 };
// 镜头 7 新页面右栏开在“课件”（一片白），点“我的图谱”后多久星图画出来（量的约 0.2 秒）
const TAB_SETTLE = 0.3;

const round3 = (x) => Math.round(x * 1000) / 1000;

// 镜头标记 shot.N.start / shot.N.end → [{ shot, start, end }]
export function shotWindows(marks) {
  const windows = [];
  for (const m of marks) {
    const hit = m.name.match(/^shot\.(\d+)\.start$/);
    if (!hit) {
      continue;
    }
    const shot = Number(hit[1]);
    const end = marks.find((e) => e.name === `shot.${shot}.end` && e.t >= m.t);
    if (end) {
      windows.push({ end: end.t, shot, start: m.t });
    }
  }
  return windows;
}

// 导师每一轮回复：开始忙 → 第一次露出内容（shown）→ 忙完。找不到露出就记成忙完那一刻
export function replySpans(ui) {
  const spans = [];
  for (let i = 0; i < ui.length; i += 1) {
    const e = ui[i];
    if (e.type !== "stream" || e.state !== "start") {
      continue;
    }
    let shown = null;
    let end = null;
    for (let j = i + 1; j < ui.length; j += 1) {
      const f = ui[j];
      if (f.type === "stream" && f.state === "end") {
        end = f.v;
        break;
      }
      if (
        shown === null &&
        f.type === "ui" &&
        SHOWN_KEYS.has(f.key) &&
        f.value
      ) {
        shown = f.v;
      }
    }
    if (end !== null && end > e.v) {
      spans.push({ end, shown: shown ?? end, start: e.v });
    }
  }
  return spans;
}

// 导师思考中的时段：开始忙 → 回复第一次露出内容
export function thinkingSpans(ui) {
  return replySpans(ui)
    .filter((s) => s.shown > s.start)
    .map((s) => ({ end: s.shown, start: s.start }));
}
const holdCap = (label = "") =>
  HOLD_LONGER.find(([re]) => re.test(label))?.[1] ?? HOLD_MAX;
// 镜头收紧时（PACE.holdScale）也不缩的停留：星星全亮是这一镜的落点
const HOLD_FULL = /全亮/;
// 停留多久（秒）：日志里记的是毫秒，超过上限的按上限算；scale 把上限按比例缩短
const holdLen = (m, scale = 1) =>
  Math.min(
    (m.ms ?? 0) / 1000,
    holdCap(m.label) * (HOLD_FULL.test(m.label ?? "") ? 1 : scale)
  );

// 个别镜头收得更紧（用户 2026-10-24 选“全保留、镜头 7 收紧”时用）：停留上限乘 holdScale，
// 思考、出字、打字、整轮快放的上限换成更短的，第二天开场只留 lead 秒
// fold：匹配的那一问连同前面的“先不做题”、后面的结束学习和打开星图，整段快放到点那颗星之前（每段不超过 foldMax 秒），
//       镜头 6 已经完整演过这一套，镜头 7 只交代“又聊了一句、星图里那颗星亮了”
// dropHolds：这些停留整段剪掉（镜头 6 已经停过的连线）
export const PACE = {
  6: { holdScale: 0.85 },
  7: {
    dropHolds: /连线/,
    fold: /哲学家就餐/,
    foldMax: 1.5,
    holdScale: 0.75,
    lead: 0.8,
    maxIdle: 0.6,
    repeatMax: 1.2,
    streamMax: 1.5,
    typeMax: 1.5,
  },
};

// 快放的整轮作答：反例追问、第二道起的独立题、复习后再答、第二次“考我”
const REPEAT = /(?:独立题|考我)([2-9])$|再答\d+$|-反例$/;

function repeatRounds(marks, scale = 1) {
  const rounds = [];
  for (const m of marks) {
    const hit = m.name.match(/^wait\.reply\.(.+)\.start$/);
    if (!(hit && REPEAT.test(hit[1]))) {
      continue;
    }
    const end = marks.find(
      (e) => e.name === `wait.reply.${hit[1]}.end` && e.t >= m.t
    );
    const prev = marks.findLast(
      (e) => /^wait\.reply\..+\.end$/.test(e.name) && e.t <= m.t
    );
    if (!end) {
      continue;
    }
    // 上一轮回完之后如果还停留看了什么，从停留结束算起
    let base = prev?.t ?? m.t;
    for (const e of marks) {
      if (e.name === "hold" && e.t >= base && e.t < m.t) {
        base = e.t + holdLen(e, scale);
      }
    }
    const first = marks.find(
      (e) =>
        (e.name === "click" || e.name === "type.start") &&
        e.t >= base &&
        e.t <= m.t
    );
    rounds.push({ end: end.t, start: first ? first.t - 0.4 : base });
  }
  return rounds;
}

// 画面上什么都没动的时段：光标、点击、页面变化、标记之间的空当（停留另算）
function idleSpans(aligned, window) {
  const times = [
    window.start,
    window.end,
    ...(aligned.cursor ?? []).map((c) => c.t),
    ...(aligned.clicks ?? []).map((c) => c.t),
    ...(aligned.ui ?? []).map((e) => e.v),
    ...(aligned.marks ?? []).map((m) => m.t),
  ]
    .filter((t) => t >= window.start && t <= window.end)
    .toSorted((a, b) => a - b);
  const spans = [];
  for (let i = 1; i < times.length; i += 1) {
    if (times[i] - times[i - 1] > IDLE_GAP) {
      // 两头各留 0.2 秒原速，动作的起落不被加速
      spans.push({
        end: times[i] - 0.2,
        kind: "idle",
        start: times[i - 1] + 0.2,
      });
    }
  }
  return spans;
}

// 剪辑要处理的时段（kind 见文件开头）。另外：
//  keep   停留：原速（不被当成 idle），超过上限的部分 cut
//  cut    剪掉：镜头 7 开头模拟第二天、重开页面；第二次结束学习的小结；停留超长的尾巴；空白帧
export function editSpans(aligned, window, o = {}) {
  const ui = aligned.ui ?? [];
  const marks = aligned.marks ?? [];
  const scale = o.holdScale ?? 1;
  const spans = [];
  for (const r of replySpans(ui)) {
    if (r.shown > r.start) {
      spans.push({ end: r.shown, kind: "think", start: r.start });
    }
    if (r.end - r.shown > 2) {
      spans.push({ end: r.end, kind: "stream", start: r.shown });
    }
  }
  for (const r of repeatRounds(marks, scale)) {
    spans.push({ ...r, kind: "repeat" });
  }
  for (const m of marks) {
    const review = m.name.match(/^wait\.(review\..+)\.start$/);
    if (review) {
      const end = marks.find(
        (e) => e.name === `wait.${review[1]}.end` && e.t >= m.t
      );
      if (end) {
        spans.push({ end: end.t, kind: "review", start: m.t });
      }
      const again = marks.some(
        (e) => /^wait\.review\..+\.start$/.test(e.name) && e.t < m.t
      );
      const ended = marks.findLast(
        (e) => e.name === "click" && e.label === "结束本次学习" && e.t <= m.t
      );
      const opened = marks.find(
        (e) => e.name === "click" && e.label === "我的星图" && e.t > m.t
      );
      if (again && ended && opened) {
        // 从小结弹出前一点剪起（不然会闪一下加载中的小结），剪到小结关掉之后
        const popped = ui.find(
          (e) => e.key === "session-report" && e.value && e.v > ended.t
        );
        const closed = marks.find(
          (e) =>
            e.name === "click" &&
            e.label === "关闭小结" &&
            e.t > m.t &&
            e.t < opened.t
        );
        spans.push({
          end: closed ? closed.t + 0.5 : opened.t - 0.8,
          kind: "cut",
          start: popped
            ? Math.max(ended.t + 0.1, popped.v - 0.05)
            : ended.t + 0.2,
        });
      }
    }
    if (m.name === "stars.shown") {
      const opened = marks.findLast(
        (e) => e.name === "click" && e.label === "我的星图" && e.t <= m.t
      );
      if (opened && m.t - opened.t > 0.4) {
        spans.push({ end: m.t, kind: "cut", start: opened.t + 0.25 });
      }
    }
    if (m.name === "screenshot" && !m.still) {
      spans.push({
        end: m.t + SHOT_FLASH.after,
        kind: "cut",
        start: m.t - SHOT_FLASH.before,
      });
    }
    if (m.name === "type.start") {
      const end = marks.find((e) => e.name === "type.end" && e.t >= m.t);
      if (end) {
        spans.push({ end: end.t, kind: "type", start: m.t });
      }
    }
    if (
      o.fold &&
      /^wait\.reply\..+\.end$/.test(m.name) &&
      o.fold.test(m.name)
    ) {
      const asked = marks.findLast(
        (e) => e.name === m.name.replace(/\.end$/, ".start") && e.t <= m.t
      );
      const typed =
        asked &&
        marks.findLast((e) => e.name === "type.start" && e.t <= asked.t);
      const skip =
        typed &&
        marks.findLast(
          (e) =>
            e.name === "click" &&
            e.label === "先不做题" &&
            e.t <= typed.t &&
            typed.t - e.t < 15
        );
      const star = marks.find(
        (e) => e.name === "click" && e.t > m.t && o.fold.test(e.label ?? "")
      );
      spans.push({
        end: star ? star.t - 0.5 : m.t,
        kind: "fold",
        start: skip ? skip.t - 0.6 : (typed?.t ?? m.t) - 0.8,
      });
    }
    if (
      m.name === "hold" &&
      typeof m.ms === "number" &&
      o.dropHolds?.test(m.label ?? "")
    ) {
      spans.push({ end: m.t + m.ms / 1000, kind: "cut", start: m.t - 0.3 });
      continue;
    }
    if (m.name === "hold" && typeof m.ms === "number") {
      const kept = holdLen(m, scale);
      spans.push({ end: m.t + kept, kind: "keep", start: m.t });
      if (m.ms / 1000 > kept + 0.1) {
        spans.push({ end: m.t + m.ms / 1000, kind: "cut", start: m.t + kept });
      }
    }
    // 点“先不做题”和它引出的那一轮快放（不剪：剪了的话聊天记录里会凭空多出这一问一答）
    if (m.name === "click" && m.label === "先不做题") {
      const end = marks.find(
        (e) => /^wait\.reply\..*-skip\.end$/.test(e.name) && e.t >= m.t
      );
      if (end) {
        spans.push({ end: end.t, kind: "repeat", start: m.t - 0.6 });
      }
    }
    if (m.name === "wait.next-day.start" && m.t >= window.start) {
      const next = marks.find(
        (e) => e.name === "click" && e.t > m.t && e.t <= window.end
      );
      if (next) {
        // 第一下是切到“我的图谱”：从星图画出来之后开场，不拍右栏一片白的“课件”
        spans.push({
          end:
            next.label === "我的图谱"
              ? next.t + TAB_SETTLE
              : next.t - (o.lead ?? 1.5),
          kind: "cut",
          start: window.start,
        });
      }
    }
  }
  for (const b of aligned.blanks ?? []) {
    spans.push({
      end: b.to + BLANK_PAD,
      kind: "cut",
      start: b.from - BLANK_PAD,
    });
  }
  spans.push(...idleSpans(aligned, window));
  return spans;
}

const PRIORITY = {
  cut: 0,
  // 比复核等待优先：快放段里的复核等待并进快放，不单独再压一次
  fold: 0.5,
  idle: 7,
  keep: 6,
  repeat: 2,
  review: 1,
  stream: 4,
  think: 3,
  type: 5,
};

function rateFor(kind, len, o) {
  const fit = (max) => Math.ceil(len / max - 1e-9);
  switch (kind) {
    case "stream":
      return Math.max(o.streamRate, fit(o.streamMax));
    case "type":
      // 短的原速（也不算画面不动）
      return len <= o.typeMax
        ? 1
        : Math.min(TYPE_MAX_RATE, Math.max(o.minRate, fit(o.typeMax)));
    case "repeat":
      return Math.max(o.minRate, fit(o.repeatMax));
    case "fold":
      return Math.max(o.minRate, fit(o.foldMax));
    case "idle":
      return Math.max(o.minRate, fit(IDLE_MAX));
    case "keep":
      return 1;
    default:
      return Math.max(o.minRate, fit(o.maxIdle));
  }
}

// 短于这个就不处理（加速了也省不了多少，还让“已加速”角标闪一下）
function worth(kind, len, o) {
  switch (kind) {
    case "stream":
      return len > 2;
    case "repeat":
      return len > o.repeatMax;
    case "fold":
      return len > o.foldMax;
    case "idle":
      return len > IDLE_GAP - 0.4;
    case "keep":
    case "type":
    case "cut":
      return len > 0.05;
    default:
      return len > o.maxIdle;
  }
}

// 镜头时段切成片段：cut 剪掉，其余按 kind 加速，没被占的部分原速。
// 时段重叠时按 PRIORITY 取舍（数小的优先），后来的被前面的占掉的部分丢弃
export function draftClips(window, spans, options = {}) {
  const o = {
    foldMax: REPEAT_MAX,
    maxIdle: MAX_IDLE,
    minRate: MIN_RATE,
    repeatMax: REPEAT_MAX,
    streamMax: STREAM_MAX,
    streamRate: STREAM_RATE,
    typeMax: TYPE_MAX,
    ...options,
  };
  const clipped = spans
    .map((s) => ({
      end: Math.min(s.end, window.end),
      kind: s.kind ?? "think",
      start: Math.max(s.start, window.start),
    }))
    .filter((s) => worth(s.kind, s.end - s.start, o))
    .toSorted((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
  // 按优先级放进去，和已放的重叠就裁掉重叠部分
  const placed = [];
  for (const s of clipped) {
    let pieces = [s];
    for (const p of placed) {
      pieces = pieces.flatMap((q) => {
        if (q.end <= p.start || q.start >= p.end) {
          return [q];
        }
        return [
          { ...q, end: p.start },
          { ...q, start: p.end },
        ].filter((r) => r.end - r.start > 0.05);
      });
    }
    placed.push(...pieces.filter((q) => worth(q.kind, q.end - q.start, o)));
  }
  const clips = [];
  let t = window.start;
  const plain = (from, to) => {
    const last = clips.at(-1);
    if (last && !last.rate && Math.abs(last.to - from) < 1e-6) {
      last.to = round3(to);
    } else {
      clips.push({ from: round3(from), to: round3(to) });
    }
  };
  for (const s of placed.toSorted((a, b) => a.start - b.start)) {
    if (s.start > t) {
      plain(t, s.start);
    }
    const rate = rateFor(s.kind, s.end - s.start, o);
    if (s.kind === "cut") {
      // 剪掉
    } else if (rate === 1) {
      plain(s.start, s.end);
    } else {
      clips.push({ from: round3(s.start), rate, to: round3(s.end) });
    }
    t = s.end;
  }
  if (window.end > t) {
    plain(t, window.end);
  }
  return clips;
}

const HOME = { x: 640, y: 360, zoom: 1 };

// 镜头放大的草稿：打字时 1.4 倍看输入框；点模拟器时 1.4 倍看模拟器；鼠标停留处按 HOLD_ZOOM 放大，停完回全景
export function draftCamera(
  window,
  { marks, cursor, holdScale = 1, dropHolds = null }
) {
  const inside = (t) => t >= window.start && t <= window.end;
  const at = (t) =>
    cursor.findLast((c) => c.t <= t) ?? cursor.find((c) => c.t >= t);
  const focus = [];
  for (const m of marks) {
    if (!inside(m.t)) {
      continue;
    }
    if (m.name === "type.start") {
      const end = marks.find((e) => e.name === "type.end" && e.t >= m.t);
      const p = at(m.t);
      if (end && p) {
        focus.push({
          from: m.t - 0.4,
          to: end.t + 0.2,
          x: p.x,
          y: p.y,
          zoom: TYPING_ZOOM,
        });
      }
    }
    if (
      m.name === "hold" &&
      typeof m.ms === "number" &&
      !dropHolds?.test(m.label ?? "")
    ) {
      const zoom = HOLD_ZOOM.find(([re]) => re.test(m.label ?? ""))?.[1];
      const p = at(m.t);
      if (zoom && p) {
        focus.push({
          from: m.t - 0.3,
          to: m.t + holdLen(m, holdScale),
          x: p.x,
          y: p.y,
          zoom,
        });
      }
    }
  }
  // 模拟器：从第一次点“走一步”到“模拟卡死了”停留开始，看着点过的那几处的中心
  const steps = marks.filter(
    (m) => m.name === "click" && /走一步/.test(m.label ?? "") && inside(m.t)
  );
  if (steps.length > 0) {
    const stuck = marks.find(
      (m) => m.name === "hold" && /模拟卡死了/.test(m.label ?? "")
    );
    const xs = steps.map((m) => m.x ?? at(m.t)?.x ?? HOME.x);
    const ys = steps.map((m) => m.y ?? at(m.t)?.y ?? HOME.y);
    focus.push({
      from: steps[0].t - 0.6,
      to: stuck ? stuck.t : steps.at(-1).t + 0.6,
      x: xs.reduce((a, b) => a + b, 0) / xs.length,
      y: ys.reduce((a, b) => a + b, 0) / ys.length,
      zoom: SIM_ZOOM,
    });
  }
  // 重叠时后来的接替前面的；每段结束后回全景，下一段紧接着开始就不回；同一时刻只留一个
  const sorted = focus.map(frameChat).toSorted((a, b) => a.from - b.from);
  const keys = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const f = sorted[i];
    const next = sorted[i + 1];
    keys.push({
      t: round3(f.from),
      x: round3(f.x),
      y: round3(f.y),
      zoom: f.zoom,
    });
    const until = next ? Math.min(f.to, next.from) : f.to;
    if (!next || next.from > f.to + 0.6) {
      keys.push({ t: round3(until), ...HOME });
    }
  }
  return keys.filter((k, i) => keys[i + 1]?.t !== k.t);
}

// 镜头键对到剪好的片段上：落在剪掉部分的挪到下一段开头；移动时长按那一段的倍数换成素材秒
export function fitCamera(keys, clips) {
  const out = [];
  for (const k of keys) {
    const clip =
      clips.find((c) => k.t >= c.from && k.t < c.to) ??
      clips.find((c) => c.from > k.t);
    if (!clip) {
      continue;
    }
    const t = Math.max(k.t, clip.from);
    const key = { ...k, t: round3(t) };
    if (clip.rate) {
      key.dur = round3(CAMERA_DUR * clip.rate);
    }
    if (out.at(-1)?.t === key.t) {
      out.pop();
    }
    out.push(key);
  }
  return out;
}

// 一个镜头的完整草稿
export function draftShot(aligned, window, options = {}) {
  const ui = aligned.ui ?? [];
  const clips = draftClips(
    window,
    editSpans(aligned, window, options),
    options
  );
  const inside = (t) => t >= window.start - 0.5 && t <= window.end + 0.5;
  const raw = window.end - window.start;
  const edited = clips.reduce((n, c) => n + (c.to - c.from) / (c.rate ?? 1), 0);
  const sped = clips.filter((c) => c.rate);
  return {
    camera: fitCamera(
      draftCamera(window, {
        cursor: aligned.cursor ?? [],
        dropHolds: options.dropHolds,
        holdScale: options.holdScale,
        marks: aligned.marks ?? [],
        ui,
      }),
      clips
    ),
    clicks: (aligned.clicks ?? [])
      .filter((c) => inside(c.t))
      .map(({ t, x, y }) => ({ t, x, y })),
    clips,
    cursor: (aligned.cursor ?? []).filter((c) => inside(c.t)),
    footage: aligned.video,
    stats: {
      cut: round3(raw - clips.reduce((n, c) => n + (c.to - c.from), 0)),
      edited: round3(edited),
      raw: round3(raw),
      sped: sped.map((c) => ({ ...c })),
      spedOut: round3(sped.reduce((n, c) => n + (c.to - c.from) / c.rate, 0)),
    },
    viewport: aligned.viewport,
  };
}

export function draftTake(aligned, options = {}) {
  return shotWindows(aligned.marks ?? []).map((w) => ({
    shot: w.shot,
    window: { end: round3(w.end), start: round3(w.start) },
    ...draftShot(aligned, w, { ...options, ...PACE[w.shot] }),
  }));
}
