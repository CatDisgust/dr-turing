import { describe, expect, it } from "vitest";
import type {
  Attempt,
  KnowledgeKind,
  NodeState,
  RepetitionState,
} from "@/lib/types";
import { computeMastery, masteryFromAttempts } from "../mastery";
import {
  gateKind,
  gateThreshold,
  learningStage,
  nextAction,
  type ObjectiveAction,
  pickObjective,
  type ReviewTask,
} from "../policy";
import {
  forgettingRisk,
  initialState,
  type ReviewEvidence,
  retrievability,
  scheduleReview,
} from "../scheduler";
import golden from "./golden.json";

// 金标准：golden.json 由 scripts/gen-golden.py 调 DeepTutor 原函数生成，
// 这里拿同样的输入跑翻译版，要求同输出（浮点差 < 1e-6）

const EPS = 1e-6;

type Step = { correct?: boolean; d?: Attempt["d"]; review?: boolean };

function attempt(fields: Partial<Attempt>): Attempt {
  return {
    at: "2026-10-22T00:00:00Z",
    d: 1,
    hinted: false,
    id: "a",
    producedStep: false,
    provisional: false,
    quote: "",
    sessionId: "s",
    source: "fast",
    turnId: "t",
    type: "check_correct",
    ...fields,
  };
}

function stepType(step: Step): Attempt["type"] {
  if (!step.correct) {
    return "check_wrong";
  }
  return step.review ? "review_correct" : "check_correct";
}

function fromSteps(steps: Step[]): Attempt[] {
  return steps.map((step) =>
    step.correct === undefined
      ? attempt({ d: 0, type: "said_understood" })
      : attempt({
          correct: step.correct,
          d: step.d ?? 1,
          hinted: (step.d ?? 1) !== 1,
          type: stepType(step),
        })
  );
}

describe("DeepTutor mastery.compute_mastery", () => {
  it.each(
    golden.computeMastery.map((c, i) => [i, c] as const)
  )("用例 %i", (_, c) => {
    expect(Math.abs(computeMastery(c.input) - c.output)).toBeLessThan(EPS);
  });
});

describe("DeepTutor policy.gate_threshold / gate_kind", () => {
  it.each(golden.gate)("$kind", (c) => {
    const kind = c.kind as KnowledgeKind;
    expect(gateThreshold(kind)).toBe(c.threshold);
    expect(gateKind(kind)).toBe(c.gateKind);
  });
});

describe("DeepTutor policy.learning_stage", () => {
  it.each(
    golden.learningStage.map((c, i) => [i, c] as const)
  )("用例 %i", (_, c) => {
    const attempts = c.input.attempts.map((a) =>
      attempt({
        correct: "correct" in a ? (a.correct as boolean) : undefined,
        hinted: a.hinted,
        type: a.type as Attempt["type"],
      })
    );
    expect(learningStage(attempts, c.input.explained)).toBe(c.output);
  });
});

describe("DeepTutor policy.next_objective", () => {
  it.each(
    golden.nextObjective.map((c, i) => [i, c] as const)
  )("用例 %i", (_, c) => {
    const result = pickObjective({
      deferred: new Set(c.input.deferred),
      kinds: c.input.kinds as Record<string, KnowledgeKind>,
      lessons: c.input.lessons,
      mastered: new Set(c.input.mastered),
      now: c.input.now,
      pendingKpId: c.input.pendingKpId ?? undefined,
      reviews: c.input.reviews as ReviewTask[],
      seen: new Set(c.input.seen),
      teachFirst: c.input.teachFirst,
    });
    expect(result.action).toBe(c.output.action as ObjectiveAction);
    expect(result.kpId ?? null).toBe(c.output.kpId);
  });
});

describe("BKT + 构建深度（Python 参考实现）", () => {
  it.each(golden.bkt.map((c, i) => [i, c] as const))("用例 %i", (_, c) => {
    const attempts = fromSteps(c.input as Step[]);
    c.output.forEach((expected, k) => {
      const got = masteryFromAttempts(attempts.slice(0, k + 1));
      expect(Math.abs(got.M - expected.M)).toBeLessThan(EPS);
      expect(Math.abs(got.O - expected.O)).toBeLessThan(EPS);
      expect(got.O).toBeLessThanOrEqual(got.M + EPS);
    });
  });
});

function expectState(got: RepetitionState, expected: RepetitionState) {
  for (const key of Object.keys(expected) as (keyof RepetitionState)[]) {
    const want = expected[key];
    if (typeof want === "number") {
      expect(Math.abs((got[key] as number) - want), key).toBeLessThan(EPS);
    } else {
      expect(got[key], key).toBe(want);
    }
  }
}

describe("DeepTutor scheduler.SpacedRepetitionScheduler", () => {
  it.each(
    golden.scheduler.map((c, i) => [i, c] as const)
  )("用例 %i", (_, c) => {
    const kind = c.kind as KnowledgeKind;
    const events = c.events as ReviewEvidence[];
    let state = initialState(kind, events[0].timestamp);
    events.forEach((event, k) => {
      state = scheduleReview(state, kind, event);
      expectState(state, c.states[k] as RepetitionState);
    });
    expect(
      Math.abs(retrievability(state, c.later) - c.retrievability)
    ).toBeLessThan(EPS);
    expect(
      Math.abs(
        forgettingRisk(state, c.later, c.hasActiveError) - c.forgettingRisk
      )
    ).toBeLessThan(EPS);
  });
});

// 实现规划里那张 6 轮表：数字和每轮命中的规则都要对上
describe("实现规划的 6 轮例子（竞争条件）", () => {
  const { steps, expected } = golden.planTable;
  const attempts = fromSteps(steps as Step[]);
  const signals = [
    undefined,
    undefined,
    "hint",
    undefined,
    undefined,
    undefined,
  ];
  // 每轮学生说完、引擎更新后，导师命中的规则
  const rules = [4, 5, 2, 5, 3, 6];

  it.each(
    expected.map((e, i) => [i + 1, e] as const)
  )("第 %i 轮", (turn, e) => {
    const { M, O } = masteryFromAttempts(attempts.slice(0, turn));
    expect(Number(M.toFixed(2))).toBe(e.M);
    expect(Number(O.toFixed(2))).toBe(e.O);

    // 第 5 轮答错匹配到误解“各有副本”，记为疑似；第 6 轮修正
    const node: NodeState = {
      attempts: attempts.slice(0, turn),
      explained: turn > 1,
      helpOpportunities: 0,
      helpRequests: 0,
      M,
      misconceptions:
        turn === 5
          ? [{ id: "m1", lastQuote: "", seen: 1, status: "suspected" }]
          : [],
      O,
      review: null,
      stage: "not_covered",
      stuckSessions: [],
      transferPassed: false,
    };
    const decision = nextAction({
      engagement: { giveUps: 0, justTellMe: 0, skippedQuestions: 0 },
      kpId: "kp_race",
      node,
      prereqs: [],
      signal: signals[turn - 1] as "hint" | undefined,
    });
    expect(decision.rule).toBe(rules[turn - 1]);
  });
});
