import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLearnerState, emptyNode } from "@/lib/learner/update";
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
const tailorQuestion = vi.fn();
vi.mock("../tailor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tailor")>()),
  tailorQuestion: (input: unknown) => tailorQuestion(input),
}));

const { planAndAsk } = await import("../turn");

// 2026-10-24 用户定：学生自己提新问题、规则只出题时，导师先接住他的问题，题改写到他问的情境里

const point: KnowledgePoint = {
  aliases: [],
  checkQuestions: [
    "T1 持有 A 等 B、T2 持有 B 等 A，会发生什么？",
    "锁超时机制是如何处理死锁的？",
  ],
  definition: "两个事务互相等对方手里的锁",
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

// 「死锁」看懂了（M ≥ 0.6）还没真会（O < 0.7）：规则⑤ 只出独立题
const turn = (M: number) => {
  const state = {
    ...emptyLearnerState("u", "c"),
    nodes: { dl: { ...emptyNode(), M, O: 0.3 } },
  };
  return {
    graph,
    now: "2026-10-24T01:00:00Z",
    sessionId: "s1",
    state,
    text: "操作系统课里的哲学家就餐问题，和这个是一回事吗？",
    turnId: "t1",
  };
};

const PHILO = "五个哲学家都先拿左手的筷子，会发生什么？怎样拿能避免？";

describe("学生自己提的新问题", () => {
  beforeEach(() => {
    tailorQuestion.mockReset();
  });

  it("规则只出题：题改写到他问的情境里，存进待答的题，导师先接住他的问题", async () => {
    tailorQuestion.mockResolvedValue(PHILO);
    const t = turn(0.7);
    const out = await planAndAsk(t, {
      note: null,
      state: t.state,
      studentAsked: true,
      touched: point,
    });
    expect(out.plan?.next_action).toBe("independent_check");
    expect(tailorQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "check",
        question: point.checkQuestions[0],
        studentText: t.text,
      })
    );
    expect(out.question).toBe(PHILO);
    expect(out.state.pendingQuestion?.question).toBe(PHILO);
    expect(out.note).toContain("学生这一轮自己提了个问题");
    expect(out.note).toContain(PHILO);
  });

  it("不用改写（问的就是这个点本身）：出原题，导师照样先接住", async () => {
    tailorQuestion.mockResolvedValue(null);
    const t = turn(0.7);
    const out = await planAndAsk(t, {
      note: null,
      state: t.state,
      studentAsked: true,
      touched: point,
    });
    expect(out.question).toBe(point.checkQuestions[0]);
    expect(out.state.pendingQuestion?.question).toBe(point.checkQuestions[0]);
    expect(out.note).toContain("学生这一轮自己提了个问题");
  });

  it("改写失败：出原题，不影响这一轮", async () => {
    tailorQuestion.mockRejectedValue(new Error("offline"));
    const t = turn(0.7);
    const out = await planAndAsk(t, {
      note: null,
      state: t.state,
      studentAsked: true,
      touched: point,
    });
    expect(out.question).toBe(point.checkQuestions[0]);
  });

  it("还没看懂（规则④讲解）：导师本来就会讲，不改写", async () => {
    const t = turn(0.2);
    const out = await planAndAsk(t, {
      note: null,
      state: t.state,
      studentAsked: true,
      touched: point,
    });
    expect(out.plan?.next_action).toBe("teach");
    expect(tailorQuestion).not.toHaveBeenCalled();
    expect(out.note ?? "").not.toContain("自己提了个问题");
  });

  it("不是学生自己提问（比如点了开始学习）：不改写", async () => {
    const t = turn(0.7);
    const out = await planAndAsk(t, {
      note: null,
      state: t.state,
      touched: point,
    });
    expect(tailorQuestion).not.toHaveBeenCalled();
    expect(out.question).toBe(point.checkQuestions[0]);
  });
});
