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
// 批改结果直接给定：学生说“不知道”
vi.mock("../grade", () => ({
  gradeAnswer: () =>
    Promise.resolve({
      correct: false,
      dontKnow: true,
      isAnswer: true,
      misconception: "",
      producedStep: false,
    }),
}));

const { answerTurn } = await import("../turn");

// 建模审查第 2 条：说“不知道”也是证据，记一次答错，M 往下走

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
  points: [point("dl", "死锁")],
};

describe("学生说不知道", () => {
  it("记一次答错、不带错误想法，题留着给提示后再试", async () => {
    const result = await answerTurn({
      graph,
      now: "2026-10-23T01:00:00Z",
      sessionId: "s1",
      state: {
        ...emptyLearnerState("u", "c"),
        pendingQuestion: {
          askedAt: "2026-10-23T00:00:00Z",
          askedTurnId: "t0",
          help: "none",
          kind: "check",
          kpId: "dl",
          question: "什么是死锁？",
          questionId: "dl:q0",
          sessionId: "s1",
        },
      },
      text: "不知道",
      turnId: "t1",
    });
    expect(result?.graded).toMatchObject({ correct: false, dontKnow: true });
    const node = result?.state.nodes.dl;
    expect(node?.attempts).toHaveLength(1);
    expect(node?.attempts[0]).toMatchObject({
      correct: false,
      type: "check_wrong",
    });
    expect(node?.attempts[0].misconception).toBeUndefined();
    expect(node?.M).toBeLessThan(0.3);
    expect(result?.state.pendingQuestion?.help).toBe("hint");
    expect(result?.note).toContain("不会");
  });
});
