import { describe, expect, it } from "vitest";
import { FULL_O } from "@/lib/learner/config";
import { nodeLight } from "@/lib/learner/light";
import { planTurn } from "@/lib/learner/planner";
import { attemptFromGrading, pickQuestion } from "@/lib/learner/question";
import { applyEvidence, emptyLearnerState } from "@/lib/learner/update";
import type { CourseGraph, KnowledgePoint } from "@/lib/types";
import { compareRuns } from "../compare";
import {
  DEMO_STUDENT,
  demoTarget,
  lessonPoints,
  seedDemoStudent,
  seedNextDay,
  seedScene2,
  seedStudents,
  seedSummary,
} from "../seed";

// D11：A、B 的预置历史由引擎重放出来；同一个目标点，规则给两人的规划不一样

const point = (
  id: string,
  name: string,
  extra: Partial<KnowledgePoint> = {}
): KnowledgePoint => ({
  aliases: [],
  checkQuestions: [`${name}？`],
  definition: name,
  id,
  kind: "concept",
  lessonId: "l2",
  name,
  sources: [],
  status: "auto",
  ...extra,
});

const pre = (from: string, to: string) => ({
  from,
  status: "tentative" as const,
  to,
  type: "prereq" as const,
});

const graph: CourseGraph = {
  builtAt: "",
  courseId: "comp5348",
  edges: [
    pre("lock", "dl"),
    pre("conc", "lock"),
    pre("ctrl", "lock"),
    pre("txn", "conc"),
  ],
  lessons: [{ fileIds: [], id: "l2", index: 2, title: "COMP5348_W2" }],
  name: "comp5348",
  points: [
    point("conc", "并发及其问题"),
    point("ctrl", "并发控制"),
    point("txn", "事务"),
    point("lock", "悲观并发控制（加锁）", { kind: "procedure" }),
    point("dl", "死锁"),
    point("opt", "乐观并发控制"),
  ],
};

const now = new Date("2026-10-22T12:00:00Z");

const seeded = (g: CourseGraph = graph) => {
  const seed = seedStudents(g, "comp5348", now);
  if (!seed) {
    throw new Error("没找到目标点");
  }
  return seed;
};

const sorted = (ids: string[]) => [...ids].sort((x, y) => x.localeCompare(y));

describe("seedStudents", () => {
  it("按名字找到死锁这个点", () => {
    expect(demoTarget(graph)?.id).toBe("dl");
    expect(
      demoTarget({
        ...graph,
        points: graph.points.filter((p) => p.id !== "dl"),
      })
    ).toBeNull();
  });

  it("A 的两跳前置都到半亮，B 的都没到", () => {
    const seed = seeded();
    const rows = seedSummary(seed);
    expect(sorted(rows.map((r) => r.id))).toEqual(["conc", "ctrl", "lock"]);
    expect(rows.every((r) => r.aOwned)).toBe(true);
    expect(rows.every((r) => !r.bOwned)).toBe(true);
    expect(seed.a.nodes.dl).toBeUndefined();
    expect(seed.b.nodes.dl?.misconceptions[0]?.status).not.toBe("repaired");
    expect(seed.b.nodes.conc?.helpRequests).toBeGreaterThan(0);
  });

  it("规则默认值：A 讲解、从前置讲起；B 先查误解、没有可借力的前置", () => {
    const seed = seeded();
    const plan = (state: typeof seed.a) =>
      planTurn({ graph, kpId: "dl", sessionId: "s", state });
    const a = plan(seed.a);
    const b = plan(seed.b);
    expect(a.next_action).toBe("teach");
    expect(sorted(a.start_from)).toEqual(["conc", "ctrl", "lock"]);
    expect(a.check_misconception_first).toBeUndefined();
    expect(b.next_action).toBe("diagnose_misconception");
    expect(b.start_from).toEqual([]);
    expect(b.check_misconception_first).toBe("只要用了锁就一定会死锁");
    expect(a.disclosure_level).not.toBe(b.disclosure_level);
  });

  it("B 的错误想法来自他自己的错答，记在他身上，不靠课程图谱", () => {
    const seed = seeded();
    const [m] = seed.b.nodes.dl?.misconceptions ?? [];
    expect(m?.text).toBe("只要用了锁就一定会死锁");
    expect(m?.lastQuote).toContain("两个任务都加了锁");
    expect(seed.a.nodes.dl).toBeUndefined();
  });
});

describe("compareRuns", () => {
  const seed = seeded();
  const a = planTurn({ graph, kpId: "dl", sessionId: "s", state: seed.a });
  const b = planTurn({ graph, kpId: "dl", sessionId: "s", state: seed.b });

  it("规则默认值下 A、B 至少 3 项不同，5 次都一样就算稳定", () => {
    const verdict = compareRuns(Array.from({ length: 5 }, () => ({ a, b })));
    expect(verdict.alwaysDifferent).toBeGreaterThanOrEqual(3);
    expect(verdict.stable).toBe(true);
    expect(verdict.pass).toBe(true);
  });

  it("某一项有时同有时不同，就是方向变了", () => {
    const flipped = { ...b, start_from: a.start_from };
    const verdict = compareRuns([
      { a, b },
      { a, b: flipped },
    ]);
    expect(verdict.fields.find((f) => f.field === "start_from")?.stable).toBe(
      false
    );
    expect(verdict.pass).toBe(false);
  });

  it("start_from 顺序不同不算不同", () => {
    const reordered = { ...a, start_from: [...a.start_from].reverse() };
    expect(compareRuns([{ a, b: reordered }]).alwaysDifferent).toBe(0);
  });
});

describe("线上图谱的样子", () => {
  // 死锁只有一个前置：加锁；加锁 part_of 并发控制，自己没有前置
  const online: CourseGraph = {
    ...graph,
    edges: [
      pre("lock", "dl"),
      {
        from: "lock",
        status: "tentative" as const,
        to: "ctrl",
        type: "part_of" as const,
      },
    ],
  };

  it("只有一个前置也能拉开：A 从加锁讲起，B 先查误解", () => {
    const seed = seeded(online);
    expect(seedSummary(seed).map((r) => r.id)).toEqual(["lock"]);
    const a = planTurn({
      graph: online,
      kpId: "dl",
      sessionId: "s",
      state: seed.a,
    });
    const b = planTurn({
      graph: online,
      kpId: "dl",
      sessionId: "s",
      state: seed.b,
    });
    expect(a.start_from).toEqual(["lock"]);
    expect(b.start_from).toEqual([]);
    expect(compareRuns([{ a, b }]).alwaysDifferent).toBeGreaterThanOrEqual(3);
  });
});

describe("画面二预置（D12）", () => {
  const lost = point("lost", "丢失更新", {
    checkQuestions: ["两个人同时存钱为什么少一笔？", "库存扣减会怎样？"],
  });
  const g2: CourseGraph = { ...graph, points: [...graph.points, lost] };
  const other = applyEvidence(
    emptyLearnerState(DEMO_STUDENT.id, "comp5348"),
    g2,
    "txn",
    {
      at: "2026-10-20T10:00:00Z",
      correct: true,
      d: 1,
      hinted: false,
      id: "x",
      producedStep: true,
      provisional: false,
      quote: "学生自己的记录",
      sessionId: "old",
      source: "slow",
      turnId: "t",
      type: "check_correct",
    }
  );

  it("昨天的检查题和变式题让它半亮，其他点不动", () => {
    const seed = seedScene2(g2, other, now);
    expect(seed?.target.id).toBe("lost");
    const node = seed?.state.nodes.lost;
    expect(nodeLight(node, "today").light).toBe("half");
    expect(node?.O).toBeLessThan(FULL_O);
    expect(seed?.state.nodes.txn).toEqual(other.nodes.txn);
  });

  it("今天问到它：规则⑤出复习题，独立答对就全亮", () => {
    const seed = seedScene2(g2, other, now);
    if (!seed) {
      throw new Error("没找到丢失更新");
    }
    const plan = planTurn({
      graph: g2,
      kpId: "lost",
      sessionId: "today",
      state: seed.state,
    });
    expect(plan.next_action).toBe("independent_check");
    const today = now.toISOString();
    const picked = pickQuestion(lost, seed.state.nodes.lost, "today", today);
    expect(picked?.kind).toBe("review");
    if (!picked) {
      throw new Error("没出题");
    }
    const evidence = attemptFromGrading(
      {
        ...picked,
        askedAt: today,
        askedTurnId: "t1",
        help: "none",
        kpId: "lost",
        sessionId: "today",
      },
      { correct: true, misconception: "", producedStep: true },
      { at: today, id: "a1", quote: "后写的覆盖了先写的", turnId: "t2" }
    );
    const after = applyEvidence(seed.state, g2, "lost", evidence);
    expect(nodeLight(after.nodes.lost, "today").light).toBe("full");
  });

  it("图里没有丢失更新就不写", () => {
    expect(seedScene2(graph, other, now)).toBeNull();
  });
});

// 演示视频的“第二天”（用户 2026-10-23 定：全程只讲死锁）
describe("第二天预置：死锁", () => {
  const dl = graph.points.find((p) => p.id === "dl") as KnowledgePoint;
  // 今天在死锁上很确定却答错的真实记录，写“第二天”时会被换掉
  const today = applyEvidence(
    emptyLearnerState(DEMO_STUDENT.id, "comp5348"),
    graph,
    "dl",
    {
      at: now.toISOString(),
      confidence: "sure",
      correct: false,
      d: 0,
      hinted: false,
      id: "x",
      misconception: "只要加锁就会死锁",
      producedStep: false,
      provisional: true,
      quote: "还会。只要加了锁，就可能死锁",
      sessionId: "today",
      source: "fast",
      turnId: "t",
      type: "check_wrong",
    }
  );
  const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  it("昨天答错又改对：半亮，错误想法已修正，今天的记录换成预置", () => {
    const seed = seedNextDay(graph, today, nextDay);
    expect(seed?.target.id).toBe("dl");
    const node = seed?.state.nodes.dl;
    expect(nodeLight(node, "next").light).toBe("half");
    expect(node?.O).toBeLessThan(FULL_O);
    expect(node?.misconceptions.map((m) => m.status)).toEqual(["repaired"]);
    expect(node?.attempts.every((a) => a.sessionId === "seed-next-day")).toBe(
      true
    );
  });

  it("第二天问到它：出复习题，独立答对就全亮", () => {
    const seed = seedNextDay(graph, today, nextDay);
    if (!seed) {
      throw new Error("没找到死锁");
    }
    const plan = planTurn({
      graph,
      kpId: "dl",
      sessionId: "next",
      state: seed.state,
    });
    expect(plan.next_action).toBe("independent_check");
    const at = nextDay.toISOString();
    const picked = pickQuestion(dl, seed.state.nodes.dl, "next", at);
    expect(picked?.kind).toBe("review");
    if (!picked) {
      throw new Error("没出题");
    }
    const evidence = attemptFromGrading(
      {
        ...picked,
        askedAt: at,
        askedTurnId: "t1",
        help: "none",
        kpId: "dl",
        sessionId: "next",
      },
      { correct: true, misconception: "", producedStep: true },
      { at, id: "a1", quote: "顺序一样，等待绕不成圈", turnId: "t2" }
    );
    const after = applyEvidence(seed.state, graph, "dl", evidence);
    expect(nodeLight(after.nodes.dl, "next").light).toBe("full");
  });
});

// 用户 2026-10-23 定的演示学生起点：第 1 课学完、第 2 课学一半、第 3 课全灰
describe("演示学生的预置起点", () => {
  const at = new Date("2026-10-23T09:00:00Z");
  const lesson = (n: number, size: number) =>
    Array.from({ length: size }, (_, i) =>
      point(`l${n}-${i}`, `第${n}课点${i}`, { lessonId: `l${n}` })
    );
  const g3: CourseGraph = {
    ...graph,
    edges: [pre("l1-1", "l1-0")],
    lessons: [1, 2, 3].map((n) => ({
      fileIds: [],
      id: `l${n}`,
      index: n,
      title: `W${n}`,
    })),
    points: [
      ...lesson(1, 26),
      ...lesson(2, 23),
      point("dl", "死锁", { lessonId: "l2" }),
      point("lost", "丢失更新", { lessonId: "l2" }),
      ...lesson(3, 23),
    ],
  };
  const count = (state: ReturnType<typeof seedDemoStudent>, n: number) => {
    const c = { full: 0, gray: 0, half: 0 } as Record<string, number>;
    for (const p of g3.points.filter((q) => q.lessonId === `l${n}`)) {
      c[nodeLight(state.nodes[p.id]).light] += 1;
    }
    return c;
  };

  it("第 1 课 20 全亮 4 半亮，第 2 课 3 全亮 9 半亮，第 3 课全灰", () => {
    const s = seedDemoStudent(g3, "comp5348", at);
    expect(count(s, 1)).toEqual({ full: 20, gray: 2, half: 4 });
    expect(count(s, 2)).toEqual({ full: 3, gray: 13, half: 9 });
    expect(count(s, 3)).toEqual({ full: 0, gray: 23, half: 0 });
  });

  it("死锁不碰；丢失更新交给画面二，放成半亮", () => {
    const s = seedDemoStudent(g3, "comp5348", at);
    expect(s.nodes.dl).toBeUndefined();
    expect(s.nodes.lost).toBeUndefined();
    const scene2 = seedScene2(g3, s, at);
    expect(nodeLight(scene2?.state.nodes.lost).light).toBe("half");
    expect(count(scene2?.state ?? s, 2).half).toBe(10);
  });

  it("课内先亮前置", () => {
    const [first] = lessonPoints(g3);
    expect(first.findIndex((p) => p.id === "l1-1")).toBeLessThan(
      first.findIndex((p) => p.id === "l1-0")
    );
  });

  it("第 2 课有一个答错的点记下了错误想法", () => {
    const s = seedDemoStudent(g3, "comp5348", at);
    const ideas = Object.values(s.nodes).flatMap((n) => n.misconceptions);
    expect(ideas.map((m) => m.text)).toContain("加了锁就不会有任何并发问题");
  });
});

describe("A、B 补上第 1 课后，死锁的规划输入不变", () => {
  it("目标点、前置、易混点的状态和只重放前置时一样", () => {
    const g = {
      ...graph,
      lessons: [
        { fileIds: [], id: "l1", index: 1, title: "W1" },
        ...graph.lessons,
      ],
      points: [
        ...graph.points,
        ...Array.from({ length: 6 }, (_, i) =>
          point(`w1-${i}`, `第一课点${i}`, { lessonId: "l1" })
        ),
      ],
    };
    const at = new Date("2026-10-23T09:00:00Z");
    const before = seedStudents(graph, "comp5348", at);
    const after = seedStudents(g, "comp5348", at);
    // 死锁自己、一跳前置加锁、两跳前置并发及其问题和并发控制
    for (const id of ["dl", "lock", "conc", "ctrl"]) {
      expect(after?.a.nodes[id]).toEqual(before?.a.nodes[id]);
      expect(after?.b.nodes[id]).toEqual(before?.b.nodes[id]);
    }
    expect(nodeLight(after?.a.nodes["w1-0"]).light).toBe("full");
    expect(nodeLight(after?.b.nodes["w1-0"]).light).not.toBe("full");
  });
});
