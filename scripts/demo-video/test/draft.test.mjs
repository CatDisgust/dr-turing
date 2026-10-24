import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  appearances,
  draftCamera,
  draftClips,
  draftTake,
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

  test("出现：从无到有、数量变多都算，值不变不算", () => {
    const events = [
      ui(1, "check-card", null, { count: 0 }),
      ui(2, "check-card", "题 1", { count: 1 }),
      ui(3, "check-card", "题 1 改", { count: 1 }),
      ui(4, "check-card", "题 2", { count: 2 }),
    ];
    assert.deepEqual(
      appearances(events, "check-card").map((e) => e.v),
      [2, 4]
    );
  });

  test("镜头：打字时 1.4 倍看输入框，标签出现时 2 倍，之后回全景", () => {
    const keys = draftCamera(
      { end: 60, start: 16 },
      {
        cursor: [{ t: 17.5, x: 430, y: 616 }],
        marks: [mark("type.start", 18), mark("type.end", 19.3)],
        ui: [
          ui(31.5, "start-from", "· 从你会的「悲观并发控制（加锁）」讲起", {
            count: 1,
            rect: { h: 20, w: 300, x: 300, y: 100 },
          }),
        ],
      }
    );
    assert.deepEqual(keys, [
      { t: 17.6, x: 430, y: 616, zoom: 1.4 },
      { t: 19.5, x: 640, y: 360, zoom: 1 },
      { t: 31.7, x: 450, y: 110, zoom: 2 },
      { t: 34.3, x: 640, y: 360, zoom: 1 },
    ]);
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
    assert.equal(shot.stats.edited, 35.75);
    assert.equal(shot.stats.sped.length, 1);
  });
});
