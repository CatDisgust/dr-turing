import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  draftCamera,
  draftClips,
  draftTake,
  editSpans,
  fitCamera,
  shotWindows,
  thinkingSpans,
} from "../lib/draft.mjs";

const mark = (name, t) => ({ name, t });
const ui = (v, key, value, extra = {}) => ({
  key,
  type: "ui",
  v,
  value,
  ...extra,
});
const stream = (v, state) => ({ state, type: "stream", v });
const hold = (t, label, ms) => ({ label, ms, name: "hold", t });
const kinds = (spans, ...only) =>
  spans
    .filter((s) => only.includes(s.kind))
    .map((s) => [s.kind, s.start, s.end]);

describe("剪辑单草稿", () => {
  test("按 shot.N.start / end 切镜头", () => {
    const marks = [
      mark("record.start", 1),
      mark("shot.3.start", 2),
      mark("shot.3.end", 12),
      mark("shot.4.start", 16),
      mark("shot.4.end", 60),
      mark("shot.5.start", 61),
    ];
    assert.deepEqual(shotWindows(marks), [
      { end: 12, shot: 3, start: 2 },
      { end: 60, shot: 4, start: 16 },
    ]);
  });

  test("思考中：开始忙到回复露出内容；没露出就到忙完", () => {
    const events = [
      stream(20, "start"),
      ui(20.1, "busy", true),
      ui(20.2, "assistant", 1),
      ui(31.5, "plan", "Dr.Turing · 讲解", { count: 1 }),
      stream(45, "end"),
      stream(50, "start"),
      stream(52, "end"),
    ];
    assert.deepEqual(thinkingSpans(events), [
      { end: 31.5, start: 20 },
      { end: 52, start: 50 },
    ]);
  });

  test("新日志用 reply-shown 判断露出", () => {
    const events = [
      stream(5, "start"),
      ui(5.1, "reply-shown", 0),
      ui(9, "reply-shown", 1),
      stream(20, "end"),
    ];
    assert.deepEqual(thinkingSpans(events), [{ end: 9, start: 5 }]);
  });

  test("思考超过 0.8 秒加速到约 0.8 秒，其余原速；短的不动", () => {
    const clips = draftClips({ end: 60, start: 16 }, [
      { end: 31.5, start: 27.1 },
      { end: 40.5, start: 40 },
    ]);
    assert.deepEqual(clips, [
      { from: 16, to: 27.1 },
      { from: 27.1, rate: 6, to: 31.5 },
      { from: 31.5, to: 60 },
    ]);
  });

  test("跨出镜头的思考只取镜头内的部分", () => {
    const clips = draftClips({ end: 10, start: 0 }, [{ end: 3, start: -5 }]);
    assert.deepEqual(clips, [
      { from: 0, rate: 4, to: 3 },
      { from: 3, to: 10 },
    ]);
  });

  test("镜头：打字时 1.4 倍看输入框，停在“从你会的…”上放大（对话列里最多 1.75 倍、整列居中），停完回全景", () => {
    const keys = draftCamera(
      { end: 60, start: 16 },
      {
        cursor: [
          { t: 17.5, x: 430, y: 616 },
          { t: 31.4, x: 450, y: 110 },
        ],
        marks: [
          mark("type.start", 18),
          mark("type.end", 19.3),
          hold(31.5, "从你会的…讲起", 2500),
          hold(40, "镜头 3 星图", 6000),
        ],
      }
    );
    assert.deepEqual(keys, [
      { t: 17.6, x: 444, y: 616, zoom: 1.4 },
      { t: 19.5, x: 640, y: 360, zoom: 1 },
      { t: 31.2, x: 444, y: 110, zoom: 1.75 },
      { t: 33.5, x: 640, y: 360, zoom: 1 },
    ]);
  });

  test("镜头：点模拟器时看着模拟器，接着停在“模拟卡死了”上不回全景", () => {
    const keys = draftCamera(
      { end: 60, start: 0 },
      {
        cursor: [
          { t: 9, x: 500, y: 400 },
          { t: 11, x: 600, y: 400 },
          { t: 14.5, x: 560, y: 450 },
        ],
        marks: [
          { label: "T1 走一步", name: "click", t: 10 },
          { label: "T2 走一步", name: "click", t: 12 },
          hold(14.5, "模拟卡死了", 2500),
        ],
      }
    );
    assert.deepEqual(keys, [
      { t: 9.4, x: 444, y: 400, zoom: 1.4 },
      { t: 14.2, x: 444, y: 450, zoom: 1.4 },
      { t: 16.5, x: 640, y: 360, zoom: 1 },
    ]);
  });

  test("镜头键对到片段：剪掉处挪到下一段开头，加速段里移动时长乘倍数", () => {
    const clips = [
      { from: 0, to: 10 },
      { from: 12, rate: 4, to: 20 },
    ];
    assert.deepEqual(
      fitCamera(
        [
          { t: 5, x: 1, y: 1, zoom: 2 },
          { t: 11, x: 640, y: 360, zoom: 1 },
          { t: 25, x: 2, y: 2, zoom: 2 },
        ],
        clips
      ),
      [
        { t: 5, x: 1, y: 1, zoom: 2 },
        { dur: 3.2, t: 12, x: 640, y: 360, zoom: 1 },
      ]
    );
  });

  test("整条 take：每个镜头一份，带统计", () => {
    const aligned = {
      clicks: [{ t: 20, testid: "send-button", x: 745, y: 674 }],
      cursor: [
        { t: 1, x: 0, y: 0 },
        { t: 20, x: 745, y: 674 },
      ],
      marks: [mark("shot.4.start", 16), mark("shot.4.end", 60)],
      ui: [stream(21, "start"), ui(30, "reply-shown", 1), stream(40, "end")],
      video: "screen.mov",
      viewport: { height: 1440, scale: 2, width: 2560, x: 0, y: 0 },
    };
    const [shot] = draftTake(aligned);
    assert.equal(shot.shot, 4);
    assert.equal(shot.footage, "screen.mov");
    assert.deepEqual(shot.clicks, [{ t: 20, x: 745, y: 674 }]);
    assert.deepEqual(shot.cursor, [{ t: 20, x: 745, y: 674 }]);
    assert.equal(shot.stats.raw, 44);
    // 思考 21–30 压到 0.75 秒，出字 30–40 压到 2 秒，16–20、40–60 画面不动也快放
    assert.deepEqual(shot.clips, [
      { from: 16, to: 16.2 },
      { from: 16.2, rate: 6, to: 19.8 },
      { from: 19.8, to: 21 },
      { from: 21, rate: 12, to: 30 },
      { from: 30, rate: 5, to: 40 },
      { from: 40, to: 40.2 },
      { from: 40.2, rate: 33, to: 59.8 },
      { from: 59.8, to: 60 },
    ]);
    assert.equal(shot.stats.edited, 5.744);
    assert.equal(shot.stats.sped.length, 4);
  });

  test("要处理的时段：思考、出字、复核等待、先不做题快放、模拟第二天剪掉", () => {
    const aligned = {
      marks: [
        mark("shot.7.start", 100),
        mark("wait.next-day.start", 100.5),
        mark("wait.next-day.end", 102),
        { label: "输入框", name: "click", t: 108 },
        { label: "先不做题", name: "click", t: 120 },
        mark("wait.reply.镜头7-skip.start", 120.2),
        mark("wait.reply.镜头7-skip.end", 126),
        mark("wait.review.shot7.start", 130),
        mark("wait.review.shot7.end", 170),
        mark("shot.7.end", 180),
      ],
      ui: [stream(109, "start"), ui(115, "reply-shown", 1), stream(119, "end")],
    };
    const spans = editSpans(aligned, { end: 180, start: 100 });
    assert.deepEqual(
      kinds(spans, "think", "stream", "cut", "repeat", "review"),
      [
        ["think", 109, 115],
        ["stream", 115, 119],
        ["cut", 100, 106.5],
        ["repeat", 119.4, 126],
        ["review", 130, 170],
      ]
    );
    const clips = draftClips({ end: 180, start: 100 }, spans);
    assert.deepEqual(clips, [
      { from: 106.5, rate: 3, to: 107.8 },
      { from: 107.8, to: 109 },
      { from: 109, rate: 8, to: 115 },
      { from: 115, rate: 3, to: 119 },
      { from: 119, to: 119.4 },
      { from: 119.4, rate: 4, to: 126 },
      { from: 126, to: 126.2 },
      { from: 126.2, rate: 6, to: 129.8 },
      { from: 129.8, to: 130 },
      { from: 130, rate: 50, to: 170 },
      { from: 170, to: 170.2 },
      { from: 170.2, rate: 16, to: 179.8 },
      { from: 179.8, to: 180 },
    ]);
  });

  test("停留原速、最多 2 秒（题目 2.4 秒、出处 3 秒），多的剪掉；停留不算画面不动", () => {
    const window = { end: 20, start: 0 };
    const aligned = {
      cursor: [{ t: 0.5, x: 1, y: 1 }],
      marks: [hold(1, "检查题", 3000), hold(6, "哲学家就餐：出处", 4000)],
    };
    const spans = editSpans(aligned, window);
    assert.deepEqual(kinds(spans, "keep", "cut"), [
      ["keep", 1, 3.4],
      ["cut", 3.4, 4],
      ["keep", 6, 9],
      ["cut", 9, 10],
    ]);
    const clips = draftClips(window, spans);
    assert.deepEqual(clips.slice(0, 3), [
      { from: 0, to: 3.4 },
      { from: 4, rate: 3, to: 5.8 },
      { from: 5.8, to: 9 },
    ]);
  });

  test("打字压到 2.2 秒以内，最多 8 倍；短的不动", () => {
    const window = { end: 40, start: 0 };
    const marks = [
      mark("type.start", 1),
      mark("type.end", 10),
      mark("type.start", 12),
      mark("type.end", 14),
      mark("type.start", 15),
      mark("type.end", 35),
    ];
    const cursor = [0, 11, 14.5, 36, 39].map((t) => ({ t, x: 1, y: 1 }));
    const clips = draftClips(window, editSpans({ cursor, marks }, window));
    assert.deepEqual(
      clips.filter((c) => c.rate),
      [
        { from: 1, rate: 5, to: 10 },
        { from: 15, rate: 8, to: 35 },
        { from: 36.2, rate: 5, to: 38.8 },
      ]
    );
  });

  test("第二道起的独立题整轮快放，从上一轮停留结束后的第一下点击算起", () => {
    const marks = [
      mark("wait.reply.镜头5-独立题1.start", 10),
      mark("wait.reply.镜头5-独立题1.end", 20),
      hold(20.5, "独立答对", 3000),
      { label: "作答框", name: "click", t: 24 },
      mark("type.start", 24.3),
      mark("type.end", 34),
      mark("wait.reply.镜头5-独立题2.start", 36),
      mark("wait.reply.镜头5-独立题2.end", 50),
    ];
    const spans = editSpans({ marks }, { end: 60, start: 0 });
    assert.deepEqual(kinds(spans, "repeat"), [["repeat", 23.6, 50]]);
    const clips = draftClips({ end: 60, start: 0 }, spans);
    assert.ok(
      clips.some((c) => c.from === 23.6 && c.to === 50 && c.rate === 14)
    );
  });

  test("第二次结束学习：从小结弹出前剪到关掉小结之后，第一次不剪", () => {
    const click = (t, label) => ({ label, name: "click", t });
    const marks = [
      click(10, "结束本次学习"),
      mark("wait.review.shot6.start", 10.3),
      mark("wait.review.shot6.end", 30),
      click(33, "关闭小结"),
      click(35, "我的星图"),
      click(100, "结束本次学习"),
      mark("wait.review.shot7.start", 100.3),
      mark("wait.review.shot7.end", 120),
      click(124, "关闭小结"),
      click(126, "我的星图"),
    ];
    const spans = editSpans(
      { marks, ui: [ui(100.25, "session-report", "本次学习小结")] },
      { end: 200, start: 0 }
    );
    assert.deepEqual(kinds(spans, "cut"), [["cut", 100.2, 124.5]]);
  });

  test("第二次结束学习：没记到小结弹出、没点关闭时，退回按点击时间剪", () => {
    const click = (t, label) => ({ label, name: "click", t });
    const marks = [
      click(10, "结束本次学习"),
      mark("wait.review.shot6.start", 10.3),
      mark("wait.review.shot6.end", 30),
      click(35, "我的星图"),
      click(100, "结束本次学习"),
      mark("wait.review.shot7.start", 100.3),
      mark("wait.review.shot7.end", 120),
      click(126, "我的星图"),
    ];
    const spans = editSpans({ marks }, { end: 200, start: 0 });
    assert.deepEqual(kinds(spans, "cut"), [["cut", 100.2, 125.2]]);
  });

  test("打开我的星图：星星画出来之前的空黑板剪掉，很快就画出来的不剪", () => {
    const click = (t, label) => ({ label, name: "click", t });
    const spans = editSpans(
      {
        marks: [
          click(10, "我的星图"),
          mark("stars.shown", 10.7),
          click(50, "我的星图"),
          mark("stars.shown", 50.2),
        ],
      },
      { end: 100, start: 0 }
    );
    assert.deepEqual(kinds(spans, "cut"), [["cut", 10.25, 10.7]]);
  });
});
