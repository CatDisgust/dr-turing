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

const { startTurn } = await import("../turn");

// 图谱上点“开始学习”：不归类，直接以这个点为目标；换点学时不再等上一道题

const point = (id: string, name: string): KnowledgePoint => ({
  aliases: [],
  checkQuestions: [`${name}？`],
  definition: name,
  id,
  kind: "concept",
  lessonId: "l2",
  name,
  sources: [],
  status: "auto",
});

const graph: CourseGraph = {
  builtAt: "",
  courseId: "c",
  edges: [],
  lessons: [{ fileIds: [], id: "l2", index: 2, title: "W2" }],
  name: "c",
  points: [point("lost", "丢失更新"), point("dl", "死锁")],
};

const pending = (kpId: string) => ({
  askedAt: "2026-10-23T00:00:00Z",
  askedTurnId: "t0",
  help: "none" as const,
  kind: "check" as const,
  kpId,
  question: "？",
  questionId: `${kpId}:q0`,
  sessionId: "s1",
});

const turn = (kpPending?: string) => ({
  graph,
  now: "2026-10-23T01:00:00Z",
  sessionId: "s1",
  state: {
    ...emptyLearnerState("u", "c"),
    pendingQuestion: kpPending ? pending(kpPending) : undefined,
  },
  text: "我想学「死锁」",
  turnId: "t1",
});

describe("startTurn", () => {
  it("目标点直接定下来，这次会话里虚线亮", () => {
    const result = startTurn(turn(), "dl");
    expect(result.touched?.id).toBe("dl");
    expect(result.state.nodes.dl.touchedInSession).toBe("s1");
  });

  it("换了个点学：上一道没答的题清掉，不计入投入度", () => {
    const result = startTurn(turn("lost"), "dl");
    expect(result.state.pendingQuestion).toBeUndefined();
    expect(result.state.engagement.recent).toEqual([]);
  });

  it("还是同一个点：题留着", () => {
    expect(startTurn(turn("dl"), "dl").state.pendingQuestion?.kpId).toBe("dl");
  });

  it("图里没有这个点：什么也不做", () => {
    const result = startTurn(turn(), "nope");
    expect(result.touched).toBeUndefined();
  });
});
