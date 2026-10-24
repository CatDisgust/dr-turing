import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEADLOCK,
  findPoint,
  findStar,
  lightOf,
  linkedTo,
  PHILOSOPHERS,
  parseArgs,
  sessionCount,
  summaryTable,
  verdictFor,
} from "../lib/checks.mjs";

describe("亮度和查找", () => {
  test("和 lib/learner/light.ts 的门槛一致", () => {
    assert.equal(lightOf(undefined), "gray");
    assert.equal(lightOf({ M: 0.59, O: 0.1 }), "gray");
    assert.equal(lightOf({ M: 0.6, O: 0.1 }), "half");
    assert.equal(lightOf({ M: 0.2, O: 0.7 }), "full");
  });

  test("按名字找点，再按别名", () => {
    const graph = {
      points: [
        { aliases: [], id: "a", name: "丢失更新" },
        { aliases: ["deadlock"], id: "b", name: "循环等待" },
        { aliases: [], id: "c", name: "死锁" },
      ],
    };
    assert.equal(findPoint(graph, DEADLOCK).id, "c");
    assert.equal(
      findPoint({ points: graph.points.slice(0, 2) }, DEADLOCK).id,
      "b"
    );
    assert.equal(findPoint({ points: [] }, DEADLOCK), null);
  });

  const map = {
    stars: {
      dl: {
        aliases: [],
        evidence: [],
        id: "dl",
        kind: "course",
        links: [],
        name: "死锁",
        related: [],
      },
      ph: {
        aliases: [],
        evidence: [
          { quote: "哲学家就餐问题，和这个是一回事吗？", sessionId: "s1" },
          { quote: "按顺序拿筷子", sessionId: "s2" },
          { quote: "又一次", sessionId: "s2" },
        ],
        id: "ph",
        kind: "outside",
        light: "half",
        links: [{ label: "和「死锁」有关", name: "死锁", to: "dl" }],
        name: "哲学家就餐问题",
        related: [],
      },
    },
  };

  test("星图里找星、数出处来自几次对话、看连没连到死锁", () => {
    const star = findStar(map, PHILOSOPHERS);
    assert.equal(star.id, "ph");
    assert.equal(sessionCount(star), 2);
    assert.ok(linkedTo(star, DEADLOCK, map));
    const unlinked = { ...star, links: [], related: ["dl"] };
    assert.ok(linkedTo(unlinked, DEADLOCK, map));
    assert.ok(!linkedTo({ ...star, links: [], related: [] }, DEADLOCK, map));
  });
});

describe("每个镜头的判定", () => {
  test("镜头 4 全满足就过", () => {
    const v = verdictFor(4, {
      checkCard: "检查一下 两个事务按同一顺序加锁，还会死锁吗？",
      lessonName: "第 2 课 · 并发控制",
      sim: true,
      simStatus: "卡死了：T1 拿着 A 等 B……这就是死锁。",
      startFrom: "· 从你会的「丢失更新」讲起",
      touched: "死锁",
      warnings: [],
    });
    assert.deepEqual(v, { pass: true, reasons: [], warnings: [] });
  });

  test("镜头 4 缺标签、缺模拟要列出原因；点了考我只是提醒", () => {
    const v = verdictFor(4, {
      checkCard: "x",
      sim: false,
      startFrom: null,
      touched: "加锁",
      usedQuizMe: true,
      warnings: [],
    });
    assert.equal(v.pass, false);
    assert.equal(v.reasons.length, 3);
    assert.ok(v.warnings.some((w) => w.includes("考我")));
  });

  test("镜头 5：以为学会了 + 半亮", () => {
    assert.ok(
      verdictFor(5, {
        counter: { graded: "答对了。", mode: "card" },
        deadlockLight: "half",
        graded: "你很确定，但答错了。这就是「以为学会了」。",
        warnings: [],
      }).pass
    );
    const v = verdictFor(5, {
      deadlock: { M: 0.4 },
      deadlockLight: "gray",
      graded: "还差一点。",
      warnings: [],
    });
    assert.equal(v.reasons.length, 2);
  });

  test("镜头 6：暗星、连到死锁、出处是原话", () => {
    const philo = {
      evidence: [{ quote: "操作系统课里的哲学家就餐问题，和这个是一回事吗？" }],
      light: "gray",
    };
    assert.ok(
      verdictFor(6, {
        linkedToDeadlock: true,
        philo,
        reportConcepts: "新增「哲学家就餐问题」",
        reportOk: true,
        warnings: [],
      }).pass
    );
    const lit = verdictFor(6, {
      linkedToDeadlock: false,
      philo: { ...philo, light: "half" },
      reportOk: true,
      warnings: [],
    });
    assert.equal(lit.reasons.length, 2);
  });

  test("镜头 7：复习题在先、全亮、哲学家亮了且两次对话", () => {
    const ok = {
      deadlockLight: "full",
      extraAnswers: 0,
      nextDay: "next-day-shift",
      philo: { evidence: [], light: "half" },
      philoSessions: 2,
      reportOk: true,
      reviewFirst: true,
      warnings: [],
    };
    assert.ok(verdictFor(7, ok).pass);
    assert.equal(
      verdictFor(7, { ...ok, philoSessions: 1, reviewFirst: false }).reasons
        .length,
      2
    );
  });

  test("出错的镜头不过", () => {
    assert.equal(
      verdictFor(3, {
        error: "超时",
        lights: { full: 3, half: 2 },
        starMapVisible: true,
      }).pass,
      false
    );
  });
});

describe("命令行和汇总", () => {
  test("默认值和各个参数", () => {
    assert.deepEqual(parseArgs([]), {
      capture: "window",
      fromShot: 3,
      help: false,
      obs: true,
      seed: "drturing",
      snapshots: true,
      takes: 1,
      toShot: 7,
    });
    const o = parseArgs([
      "--takes",
      "3",
      "--from-shot",
      "5",
      "--to-shot",
      "6",
      "--no-obs",
    ]);
    assert.equal(o.takes, 3);
    assert.equal(o.fromShot, 5);
    assert.equal(o.toShot, 6);
    assert.equal(o.obs, false);
    assert.deepEqual(
      [parseArgs(["--shot", "4"]).fromShot, parseArgs(["--shot", "4"]).toShot],
      [4, 4]
    );
  });

  test("不合法的参数报错", () => {
    assert.throws(() => parseArgs(["--takes", "0"]));
    assert.throws(() => parseArgs(["--from-shot", "8"]));
    assert.throws(() => parseArgs(["--from-shot", "6", "--to-shot", "4"]));
    assert.throws(() => parseArgs(["--takes"]));
    assert.throws(() => parseArgs(["--bogus"]));
  });

  test("汇总表", () => {
    const table = summaryTable([
      {
        id: "t1",
        verdict: {
          3: { pass: true },
          4: { pass: false },
          5: { error: "x", pass: false },
        },
        video: "out/t1/screen.mov",
      },
      { id: "t2", verdict: { 6: { pass: false, skipped: true } } },
    ]);
    const lines = table.split("\n");
    assert.equal(lines.length, 3);
    assert.match(
      lines[0],
      /^take\s+shot3\s+shot4\s+shot5\s+shot6\s+shot7\s+video$/
    );
    assert.match(
      lines[1],
      /^t1\s+PASS\s+FAIL\s+ERR\s+-\s+-\s+out\/t1\/screen\.mov$/
    );
    assert.match(lines[2], /^t2\s+-\s+-\s+-\s+skip\s+-\s+\(no video\)$/);
  });
});
