import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  alignEvents,
  countShowinfo,
  editHints,
  findFlash,
  findFlashes,
  makeClock,
  parseSignalstats,
  probeWindow,
} from "../lib/align.mjs";

// 造一段 60fps 的亮度序列：深色底（~20），在 flashAt 帧起闪白 width 帧
function lumaSeries(n, flashes) {
  return Array.from({ length: n }, (_, frame) => {
    const lit = flashes.some(
      ([at, width]) => frame >= at && frame < at + width
    );
    return { frame, t: frame / 60, y: lit ? 235 : 20 + (frame % 3) };
  });
}

describe("闪白定位", () => {
  test("解析 ffmpeg signalstats 输出", () => {
    const text = [
      "frame:0    pts:0       pts_time:0",
      "lavfi.signalstats.YAVG=16.2",
      "frame:1    pts:1001    pts_time:0.0166833",
      "lavfi.signalstats.YAVG=230.5",
      "garbage",
    ].join("\n");
    assert.deepEqual(parseSignalstats(text), [
      { frame: 0, t: 0, y: 16.2 },
      { frame: 1, t: 0.016_683_3, y: 230.5 },
    ]);
  });

  test("找到 3 帧的闪白，长时间变亮不算", () => {
    const samples = lumaSeries(600, [
      [100, 3],
      [300, 80],
    ]);
    const flash = findFlash(samples);
    assert.equal(flash.frame, 100);
    assert.equal(flash.frames, 3);
    assert.ok(Math.abs(flash.t - 100 / 60) < 1e-9);
    assert.equal(findFlashes(samples).length, 1);
  });

  test("开头、结尾两次闪白都找到", () => {
    const flashes = findFlashes(
      lumaSeries(1000, [
        [60, 3],
        [900, 4],
      ])
    );
    assert.deepEqual(
      flashes.map((f) => f.frame),
      [60, 900]
    );
  });

  test("没有闪白返回 null", () => {
    assert.equal(findFlash(lumaSeries(300, [])), null);
  });
});

describe("时钟和对齐", () => {
  test("一个对齐点：速率 1", () => {
    const clock = makeClock([{ epochMs: 1_000_000, videoSec: 2.5 }]);
    assert.equal(clock(1_000_000), 2.5);
    assert.equal(clock(1_010_000), 12.5);
    assert.equal(clock(999_000), 1.5);
  });

  test("两个对齐点：校正漂移", () => {
    // 日志过了 600 秒，素材里过了 600.6 秒
    const clock = makeClock([
      { epochMs: 0, videoSec: 1 },
      { epochMs: 600_000, videoSec: 601.6 },
    ]);
    assert.ok(Math.abs(clock(300_000) - 301.3) < 1e-9);
  });

  test("没有对齐点要报错", () => {
    assert.throws(() => makeClock([]));
  });

  test("事件加上素材时间 v，光标抽稀、点击和标记", () => {
    const clock = makeClock([{ epochMs: 10_000, videoSec: 1 }]);
    const events = [
      { t: 10_000, type: "pointermove", x: 1, y: 1 },
      { t: 10_010, type: "pointermove", x: 2, y: 2 },
      { t: 10_040, type: "pointermove", x: 3, y: 3 },
      { t: 10_050, testid: "send-button", type: "pointerdown", x: 3, y: 3 },
      { name: "shot.4.start", t: 11_000, type: "mark" },
    ];
    assert.deepEqual(
      alignEvents(events.slice(0, 1), clock).map((e) => e.v),
      [1]
    );
    const hints = editHints(events, clock);
    assert.deepEqual(
      hints.cursor.map((c) => c.x),
      [1, 3, 3]
    );
    assert.deepEqual(hints.clicks, [
      { t: 1.05, testid: "send-button", x: 3, y: 3 },
    ]);
    assert.deepEqual(hints.marks, [{ name: "shot.4.start", t: 2 }]);
  });
});

describe("测帧率", () => {
  test("测帧率时段：对到素材时间，两头各让 0.15 秒", () => {
    const clock = makeClock([{ epochMs: 1000, videoSec: 1 }]);
    const w = probeWindow(
      [{ frames: 240, t: 2000, tEnd: 4000, type: "probe" }],
      clock
    );
    assert.deepEqual(w, { from: 2.15, pageFps: 120, to: 3.85 });
    assert.equal(probeWindow([], clock), null);
  });

  test("数 showinfo 的帧", () => {
    const text = [
      "[Parsed_showinfo_1 @ 0x1] config in time_base: 1/60",
      "[Parsed_showinfo_1 @ 0x1] n:   0 pts:      0 pts_time:0",
      "[Parsed_showinfo_1 @ 0x1] n:   1 pts:      1 pts_time:0.0166",
      "frame=    2 fps=0.0 q=-0.0",
    ].join("\n");
    assert.equal(countShowinfo(text), 2);
  });
});
