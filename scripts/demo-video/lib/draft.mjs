// 一条录好的 take（aligned.json）→ 每个镜头的剪辑单草稿：取哪段素材、哪里加速、镜头往哪放大、光标和点击。
// 输出的字段就是 post/src/edit.ts 里 ScreenShot 的 footage / viewport / clips / camera / cursor / clicks，
// 计时样带和样片直接拿来用，再手工微调。纯函数，test/draft.test.mjs 有单测；draft.mjs 负责读写文件。
// 时间都是素材秒，坐标是网页 CSS 像素（1280×720）

// 导师“思考中”（只显示等待动画、画面不动）超过 maxIdle 秒就加速到不超过 maxIdle 秒，画面会自动标“已加速”
const MAX_IDLE = 0.8;
const MIN_RATE = 2;
// 导师出字加速几倍（画面也标“已加速”）；计时样带再按讲稿逐镜调
const STREAM_RATE = 3;
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

// 小字关键处放大到约 2 倍，大块内容约 1.4 倍（制作方案“镜头放大”一行）
const FOCUS = {
  "answer-bar": { hold: 2.6, zoom: 2 },
  "check-card": { hold: 2.6, zoom: 1.4 },
  "deadlock-sim": { hold: 3, zoom: 1.4 },
  "graded-line": { hold: 2.6, zoom: 2 },
  "star-name": { hold: 2.4, zoom: 2 },
  "start-from": { hold: 2.6, zoom: 2 },
};
const TYPING_ZOOM = 1.4;

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

// 某个 ui 键从“没有”变成“有”、或者数量变多的时刻（v 是素材秒）
export function appearances(ui, key) {
  const out = [];
  let prev = null;
  for (const e of ui) {
    if (e.type !== "ui" || e.key !== key) {
      continue;
    }
    const value = typeof e.value === "number" ? e.value > 0 : Boolean(e.value);
    const grew =
      typeof e.count === "number" &&
      typeof prev?.count === "number" &&
      e.count > prev.count;
    const wasOn =
      prev &&
      (typeof prev.value === "number" ? prev.value > 0 : Boolean(prev.value));
    const more =
      typeof e.value === "number" &&
      typeof prev?.value === "number" &&
      e.value > prev.value;
    if (value && (!wasOn || grew || more)) {
      out.push(e);
    }
    prev = e;
  }
  return out;
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

// 剪辑要处理的时段：
//  think  思考中（只有等待动画）→ 加速到 maxIdle 秒以内
//  stream 导师出字 → 加速 streamRate 倍（短于 2 秒不动）
//  review 结束学习后的复核等待 → 加速到 maxIdle 秒以内
//  cut    剪掉：点“先不做题”和它引出的那一轮回复；镜头 7 开头模拟第二天、重开页面
export function editSpans(aligned, window) {
  const ui = aligned.ui ?? [];
  const marks = aligned.marks ?? [];
  const spans = [];
  for (const r of replySpans(ui)) {
    if (r.shown > r.start) {
      spans.push({ end: r.shown, kind: "think", start: r.start });
    }
    if (r.end - r.shown > 2) {
      spans.push({ end: r.end, kind: "stream", start: r.shown });
    }
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
    }
    if (m.name === "click" && m.label === "先不做题") {
      const end = marks.find(
        (e) => /^wait\.reply\..*-skip\.end$/.test(e.name) && e.t >= m.t
      );
      if (end) {
        spans.push({ end: end.t + 0.3, kind: "cut", start: m.t - 1.2 });
      }
    }
    if (m.name === "wait.next-day.start" && m.t >= window.start) {
      const next = marks.find(
        (e) => e.name === "click" && e.t > m.t && e.t <= window.end
      );
      if (next) {
        spans.push({ end: next.t - 1.5, kind: "cut", start: window.start });
      }
    }
  }
  return spans;
}

const PRIORITY = { cut: 0, review: 1, stream: 3, think: 2 };

// 镜头时段切成片段：cut 剪掉，think / review 加速到 maxIdle 秒以内，stream 加速 streamRate 倍，其余原速。
// 时段重叠时按 cut > review > think > stream 取舍，后来的被前面的占掉的部分丢弃
export function draftClips(
  window,
  spans,
  { maxIdle = MAX_IDLE, minRate = MIN_RATE, streamRate = STREAM_RATE } = {}
) {
  const clipped = spans
    .map((s) => ({
      end: Math.min(s.end, window.end),
      kind: s.kind ?? "think",
      start: Math.max(s.start, window.start),
    }))
    .filter((s) =>
      s.kind === "stream" ? s.end - s.start > 2 : s.end - s.start > maxIdle
    )
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
    placed.push(...pieces);
  }
  const clips = [];
  let t = window.start;
  for (const s of placed.toSorted((a, b) => a.start - b.start)) {
    if (s.start > t) {
      clips.push({ from: round3(t), to: round3(s.start) });
    }
    const len = s.end - s.start;
    if (s.kind === "stream") {
      clips.push({
        from: round3(s.start),
        rate: streamRate,
        to: round3(s.end),
      });
    } else if (s.kind !== "cut") {
      const rate = Math.max(minRate, Math.ceil(len / maxIdle - 1e-9));
      clips.push({ from: round3(s.start), rate, to: round3(s.end) });
    }
    t = s.end;
  }
  if (window.end > t) {
    clips.push({ from: round3(t), to: round3(window.end) });
  }
  return clips;
}

const center = (rect) => ({
  x: rect.x + rect.w / 2,
  y: rect.y + rect.h / 2,
});

// 镜头放大的草稿：打字时放大 1.4 倍看输入框，关键小字出现时放大到 2 倍停一会儿，然后回全景
export function draftCamera(window, { marks, ui, cursor }) {
  const inside = (t) => t >= window.start && t <= window.end;
  const focus = [];
  for (const m of marks) {
    if (m.name !== "type.start" || !inside(m.t)) {
      continue;
    }
    const end = marks.find((e) => e.name === "type.end" && e.t >= m.t);
    const at =
      cursor.findLast((c) => c.t <= m.t) ?? cursor.find((c) => c.t >= m.t);
    if (end && at) {
      focus.push({
        from: m.t - 0.4,
        to: end.t + 0.2,
        x: at.x,
        y: at.y,
        zoom: TYPING_ZOOM,
      });
    }
  }
  for (const [key, spec] of Object.entries(FOCUS)) {
    for (const e of appearances(ui, key)) {
      if (inside(e.v) && e.rect) {
        focus.push({
          from: e.v + 0.2,
          to: e.v + 0.2 + spec.hold,
          ...center(e.rect),
          zoom: spec.zoom,
        });
      }
    }
  }
  // 重叠时后来的接替前面的；每段结束后回全景，下一段紧接着开始就不回
  const sorted = focus.toSorted((a, b) => a.from - b.from);
  const keys = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const f = sorted[i];
    const next = sorted[i + 1];
    keys.push({ t: round3(f.from), x: f.x, y: f.y, zoom: f.zoom });
    const until = next ? Math.min(f.to, next.from) : f.to;
    if (!next || next.from > f.to + 0.6) {
      keys.push({ t: round3(until), x: 640, y: 360, zoom: 1 });
    }
  }
  return keys;
}

// 一个镜头的完整草稿
export function draftShot(aligned, window, options = {}) {
  const ui = aligned.ui ?? [];
  const clips = draftClips(window, editSpans(aligned, window), options);
  const inside = (t) => t >= window.start - 0.5 && t <= window.end + 0.5;
  const raw = window.end - window.start;
  const edited = clips.reduce((n, c) => n + (c.to - c.from) / (c.rate ?? 1), 0);
  return {
    camera: draftCamera(window, {
      cursor: aligned.cursor ?? [],
      marks: aligned.marks ?? [],
      ui,
    }),
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
      sped: clips.filter((c) => c.rate).map((c) => ({ ...c })),
    },
    viewport: aligned.viewport,
  };
}

export function draftTake(aligned, options = {}) {
  return shotWindows(aligned.marks ?? []).map((w) => ({
    shot: w.shot,
    window: { end: round3(w.end), start: round3(w.start) },
    ...draftShot(aligned, w, options),
  }));
}
