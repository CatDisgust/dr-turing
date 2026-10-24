import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createRng,
  easeInOutCubic,
  hashSeed,
  mousePath,
  moveDurationMs,
  pointInBox,
  scrollTarget,
  typingDelays,
} from "../lib/motion.mjs";

describe("随机数", () => {
  test("同一个种子给出同一串数，都在 [0,1)", () => {
    const a = createRng(42);
    const b = createRng(42);
    const xs = Array.from({ length: 50 }, () => a.next());
    assert.deepEqual(
      xs,
      Array.from({ length: 50 }, () => b.next())
    );
    assert.ok(xs.every((x) => x >= 0 && x < 1));
    assert.notDeepEqual(xs, Array.from({ length: 50 }, createRng(43).next));
  });

  test("hashSeed 稳定且区分字符串", () => {
    assert.equal(hashSeed("drturing:1"), hashSeed("drturing:1"));
    assert.notEqual(hashSeed("drturing:1"), hashSeed("drturing:2"));
  });
});

describe("缓动和轨迹", () => {
  test("easeInOutCubic 两端固定、单调", () => {
    assert.equal(easeInOutCubic(0), 0);
    assert.equal(easeInOutCubic(1), 1);
    assert.equal(easeInOutCubic(0.5), 0.5);
    let last = -1;
    for (let i = 0; i <= 100; i += 1) {
      const y = easeInOutCubic(i / 100);
      assert.ok(y >= last);
      last = y;
    }
  });

  test("用时随距离变长，有上下限", () => {
    assert.equal(moveDurationMs(0), 0);
    assert.ok(moveDurationMs(50) >= 200);
    assert.ok(moveDurationMs(200) < moveDurationMs(800));
    assert.ok(moveDurationMs(5000) <= 800);
  });

  test("轨迹约 60 步每秒、终点精确、中间是弧不是折线", () => {
    const from = { x: 100, y: 600 };
    const to = { x: 1100, y: 120 };
    const path = mousePath(from, to, createRng(7));
    const duration = moveDurationMs(Math.hypot(1000, 480));
    assert.ok(Math.abs(path.length - duration / (1000 / 60)) <= 1);
    assert.deepEqual({ x: path.at(-1).x, y: path.at(-1).y }, to);
    for (let i = 1; i < path.length; i += 1) {
      assert.ok(path[i].dt > path[i - 1].dt);
    }
    // 开头和结尾的步子比中间小（先慢后快再慢）
    const step = (i) =>
      Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    const mid = Math.floor(path.length / 2);
    assert.ok(step(1) < step(mid));
    assert.ok(step(path.length - 1) < step(mid));
    // 同一个种子同一条轨迹
    assert.deepEqual(path, mousePath(from, to, createRng(7)));
  });

  test("几乎不动时只有一个点", () => {
    assert.deepEqual(
      mousePath({ x: 10, y: 10 }, { x: 11, y: 10 }, createRng(1)),
      [{ dt: 0, x: 11, y: 10 }]
    );
  });

  test("点击点落在框中间一块", () => {
    const rng = createRng(3);
    const box = { height: 40, width: 120, x: 500, y: 300 };
    for (let i = 0; i < 100; i += 1) {
      const p = pointInBox(box, rng, 0.2);
      assert.ok(p.x >= 500 + 60 - 12 && p.x <= 500 + 60 + 12);
      assert.ok(p.y >= 300 + 20 - 4 && p.y <= 300 + 20 + 4);
    }
  });
});

describe("打字和滚动", () => {
  test("每个字 90–130ms，标点后多停", () => {
    const text = "加锁为什么会死锁？好";
    const delays = typingDelays(text, createRng(5));
    assert.equal(delays.length, [...text].length);
    for (const [i, ch] of [...text].entries()) {
      if (ch === "？") {
        assert.ok(delays[i] >= 90 + 120 && delays[i] <= 130 + 220);
      } else {
        assert.ok(delays[i] >= 90 && delays[i] <= 130);
      }
    }
  });

  const view = { maxScroll: 2000, scrollTop: 500, viewHeight: 600 };

  test("已经完整露出就不滚", () => {
    assert.equal(scrollTarget({ ...view, height: 100, top: 200 }), 500);
  });

  test("在下面就滚到刚好露出底边（留边）", () => {
    assert.equal(
      scrollTarget({ ...view, height: 100, top: 700 }, { margin: 24 }),
      500 + 700 + 100 - 600 + 24
    );
  });

  test("在上面就滚到顶边留边；放正中；不越界", () => {
    assert.equal(
      scrollTarget({ ...view, height: 100, top: -300 }),
      500 - 300 - 24
    );
    assert.equal(
      scrollTarget({ ...view, height: 100, top: 1000 }, { block: "center" }),
      500 + 1000 + 50 - 300
    );
    assert.equal(scrollTarget({ ...view, height: 100, top: -5000 }), 0);
    assert.equal(scrollTarget({ ...view, height: 100, top: 9000 }), 2000);
  });

  test("比可视区还高就顶边对齐", () => {
    assert.equal(
      scrollTarget({ ...view, height: 900, top: 300 }),
      500 + 300 - 24
    );
  });
});
