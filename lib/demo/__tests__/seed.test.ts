import { describe, expect, it } from "vitest";
import { planTurn } from "@/lib/learner/planner";
import type { CourseGraph, KnowledgePoint } from "@/lib/types";
import { compareRuns } from "../compare";
import { demoTarget, seedStudents, seedSummary } from "../seed";

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
  misconceptions: [],
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
    point("dl", "死锁", {
      misconceptions: ["只要加了锁就不会出问题"],
    }),
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
    expect(b.check_misconception_first).toBe("只要加了锁就不会出问题");
    expect(a.disclosure_level).not.toBe(b.disclosure_level);
  });

  it("目标点没写误解时 B 照样能种，只是没有误解可查", () => {
    const plain = {
      ...graph,
      points: graph.points.map((p) =>
        p.id === "dl" ? { ...p, misconceptions: [] } : p
      ),
    };
    const seed = seeded(plain);
    expect(seed.misconception).toBeUndefined();
    expect(seed.b.nodes.dl?.misconceptions).toEqual([]);
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
