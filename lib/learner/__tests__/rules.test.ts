import { describe, expect, it } from "vitest";
import type { LearnerState, NodeState } from "@/lib/types";
import { nextAction } from "../policy";

// 七条规则各命中一次，外加两条边界：先修已知薄弱时先讲先修；没证据的先修不算薄弱

function node(fields: Partial<NodeState>): NodeState {
  return {
    attempts: [],
    explained: false,
    helpOpportunities: 0,
    helpRequests: 0,
    M: 0.3,
    misconceptions: [],
    O: 0,
    review: { difficulty: 0.3, lapses: 0, stability: 0 },
    stage: "not_covered",
    stuckSessions: [],
    transferPassed: false,
    ...fields,
  };
}

const calm: LearnerState["engagement"] = {
  giveUps: 0,
  justTellMe: 0,
  skippedQuestions: 0,
};

const graded = {
  at: "",
  correct: false,
  d: 0 as const,
  hinted: false,
  id: "a",
  producedStep: false,
  provisional: false,
  quote: "",
  sessionId: "s",
  source: "fast" as const,
  turnId: "t",
  type: "check_wrong" as const,
};

describe("七条规则", () => {
  it("① 说想放弃，哪怕有误解也先安抚", () => {
    const d = nextAction({
      engagement: calm,
      kpId: "kp",
      node: node({
        misconceptions: [
          { id: "m", lastQuote: "", seen: 1, status: "suspected" },
        ],
      }),
      prereqs: [],
      signal: "give_up",
    });
    expect([d.rule, d.prompt]).toEqual([1, "min_hint"]);
  });

  it("① 跳题、放弃累计到 3 次算投入度偏低", () => {
    const d = nextAction({
      engagement: { giveUps: 1, justTellMe: 0, skippedQuestions: 2 },
      kpId: "kp",
      node: node({}),
      prereqs: [],
    });
    expect(d.rule).toBe(1);
  });

  it("② 点了给提示", () => {
    const d = nextAction({
      engagement: calm,
      kpId: "kp",
      node: node({ M: 0.9, O: 0.9 }),
      prereqs: [],
      signal: "hint",
    });
    expect([d.rule, d.action]).toEqual([2, "hint"]);
  });

  it("③ 已修正的误解不再触发", () => {
    const d = nextAction({
      engagement: calm,
      kpId: "kp",
      node: node({
        M: 0.9,
        misconceptions: [
          { id: "m", lastQuote: "", seen: 2, status: "repaired" },
        ],
        O: 0.9,
        transferPassed: true,
      }),
      prereqs: [],
    });
    expect(d.rule).toBe(7);
  });

  it("④ 先修答错过、M 低，先讲先修", () => {
    const d = nextAction({
      engagement: calm,
      kpId: "kp",
      node: node({}),
      prereqs: [
        { kpId: "kp_untested", node: node({}) },
        { kpId: "kp_weak", node: node({ attempts: [graded], M: 0.1 }) },
      ],
    });
    expect([d.rule, d.prompt, d.kpId]).toEqual([4, "aha", "kp_weak"]);
  });

  it("④ 先修没证据就不绕过去，直接讲本点", () => {
    const d = nextAction({
      engagement: calm,
      kpId: "kp",
      node: node({}),
      prereqs: [{ kpId: "kp_untested" }],
    });
    expect([d.rule, d.kpId]).toEqual([4, "kp"]);
  });

  it("⑤ M 够了但 O 不够，出独立题", () => {
    const d = nextAction({
      engagement: calm,
      kpId: "kp",
      node: node({ M: 0.8, O: 0.5 }),
      prereqs: [],
    });
    expect([d.rule, d.action]).toEqual([5, "independent_check"]);
  });

  it("⑥ 全亮但变式题没过", () => {
    const d = nextAction({
      engagement: calm,
      kpId: "kp",
      node: node({ M: 0.9, O: 0.75 }),
      prereqs: [],
    });
    expect([d.rule, d.action]).toEqual([6, "variant"]);
  });

  it("⑦ 都过了，排复习", () => {
    const d = nextAction({
      engagement: calm,
      kpId: "kp",
      node: node({ M: 0.9, O: 0.75, transferPassed: true }),
      prereqs: [],
    });
    expect([d.rule, d.prompt]).toEqual([7, "review"]);
  });
});
