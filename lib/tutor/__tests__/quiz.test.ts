import { describe, expect, it, vi } from "vitest";
import { emptyLearnerState } from "@/lib/learner/update";
import type { CourseGraph, KnowledgePoint } from "@/lib/types";
import { partText } from "../parts";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/claude", () => ({
  claude: {},
  FAST_MODEL: "opus",
  MODEL: "m",
  modelFor: () => "m",
  TIERS: {},
}));

const { quizTurn } = await import("../turn");

// “我懂了，考我”：不讲解，直接出一道独立题；上一道还没答就再给同一道

const point = (id: string, name: string, qs: string[]): KnowledgePoint => ({
  aliases: [],
  checkQuestions: qs,
  definition: name,
  id,
  kind: "concept",
  lessonId: "l3",
  name,
  sources: [],
  status: "auto",
});

const graph: CourseGraph = {
  builtAt: "",
  courseId: "c",
  edges: [],
  lessons: [{ fileIds: [], id: "l3", index: 3, title: "W3" }],
  name: "c",
  points: [
    point("dl", "死锁", ["按同一顺序加锁还会死锁吗？"]),
    point("x", "空", []),
  ],
};

const turn = (pendingQ?: string) => ({
  graph,
  now: "2026-10-23T01:00:00Z",
  sessionId: "s1",
  state: {
    ...emptyLearnerState("u", "c"),
    pendingQuestion: pendingQ
      ? {
          askedAt: "2026-10-23T00:00:00Z",
          askedTurnId: "t0",
          help: "none" as const,
          kind: "check" as const,
          kpId: "dl",
          question: pendingQ,
          questionId: "dl:q0",
          sessionId: "s1",
        }
      : undefined,
  },
  text: "我懂了，考考我",
  turnId: "t1",
});

describe("quizTurn", () => {
  it("直接出独立题，动作固定为独立题、只提问", () => {
    const quiz = quizTurn(turn(), "dl");
    expect(quiz?.step.question).toBe("按同一顺序加锁还会死锁吗？");
    expect(quiz?.step.plan?.next_action).toBe("independent_check");
    expect(quiz?.step.plan?.prompt).toBe("question");
    expect(quiz?.step.state.pendingQuestion?.askedTurnId).toBe("t1");
  });

  it("上一道还没答：再给同一道，不换题", () => {
    const quiz = quizTurn(turn("旧题"), "dl");
    expect(quiz?.step.question).toBe("旧题");
    expect(quiz?.step.state.pendingQuestion?.askedTurnId).toBe("t0");
  });

  it("这个点没有题了：不出题，让导师收尾", () => {
    const quiz = quizTurn(turn(), "x");
    expect(quiz?.step.question).toBeUndefined();
    expect(quiz?.step.note).toContain("题都做完了");
  });

  it("图里没有这个点：不处理", () => {
    expect(quizTurn(turn(), "nope")).toBeNull();
  });
});

describe("partText", () => {
  it("检查题卡片还原成题面，给导师和复核看", () => {
    expect(
      partText({
        data: { question: "为什么？" },
        type: "data-check",
      })
    ).toBe("\n\n**检查一下：**为什么？");
    expect(partText({ text: "讲解", type: "text" })).toBe("讲解");
    expect(partText({ data: {}, type: "data-sim" })).toBe("");
  });
});
