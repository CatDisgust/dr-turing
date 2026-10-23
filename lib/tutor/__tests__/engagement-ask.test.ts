import { describe, expect, it, vi } from "vitest";
import { emptyLearnerState } from "@/lib/learner/update";
import type { CourseGraph, KnowledgePoint } from "@/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/claude", () => ({
  claude: {},
  FAST_MODEL: "opus",
  MODEL: "m",
  modelFor: () => "m",
  TIERS: {},
}));
// Claude 填 plan 失败时用规则默认值
vi.mock("../plan", () => ({
  fillPlan: () => Promise.reject(new Error("offline")),
}));

const { planAndAsk } = await import("../turn");

// 建模审查第 1 条：投入度低时规则①给小提示，之后也要出题，学生才有机会答对把投入度清掉

const point: KnowledgePoint = {
  aliases: [],
  checkQuestions: ["什么是死锁？"],
  definition: "死锁",
  id: "dl",
  kind: "concept",
  lessonId: "l2",
  name: "死锁",
  sources: [],
  status: "auto",
};

const graph: CourseGraph = {
  builtAt: "",
  courseId: "c",
  edges: [],
  lessons: [{ fileIds: [], id: "l2", index: 2, title: "W2" }],
  name: "c",
  points: [point],
};

const turn = (engagementSession: string) => {
  const state = {
    ...emptyLearnerState("u", "c"),
    engagement: {
      giveUps: 3,
      justTellMe: 0,
      sessionId: engagementSession,
      skippedQuestions: 0,
    },
  };
  return {
    graph,
    now: "2026-10-23T01:00:00Z",
    sessionId: "s1",
    state,
    text: "死锁是什么？",
    turnId: "t1",
  };
};

describe("投入度低", () => {
  it("这次学习里放弃了 3 次：规则①给小提示，接着出一道题", async () => {
    const t = turn("s1");
    const out = await planAndAsk(t, {
      note: null,
      state: t.state,
      touched: point,
    });
    expect(out.plan?.next_action).toBe("hint");
    expect(out.question).toBeTruthy();
    expect(out.state.pendingQuestion?.kpId).toBe("dl");
  });

  it("放弃是上一次学习的事：这次从零算，不命中规则①", async () => {
    const t = turn("s0");
    const out = await planAndAsk(t, {
      note: null,
      state: t.state,
      touched: point,
    });
    expect(out.plan?.next_action).not.toBe("hint");
  });
});
