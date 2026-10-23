import { describe, expect, it } from "vitest";
import type { Attempt } from "@/lib/types";
import { BKT } from "../config";
import { fitLearnRate, LEARN_GRID, logLikelihood } from "../fit";
import { emptyLearnerState, learnRateOf, relearn } from "../update";

// 学生建模方案 B：每个学生一个学习率 ℓ，最大后验网格搜索

let seq = 0;
const answer = (
  kpId: string,
  correct: boolean,
  hinted = false
): { attempt: Attempt; kpId: string } => {
  seq += 1;
  return {
    attempt: {
      at: "2026-10-23T00:00:00Z",
      correct,
      d: hinted ? 0.5 : 1,
      hinted,
      id: `a${seq}`,
      producedStep: true,
      provisional: false,
      quote: "",
      sessionId: "s",
      source: "fast",
      turnId: `t${seq}`,
      type: correct ? "check_correct" : "check_wrong",
    },
    kpId,
  };
};

// 每个点：先错 wrongs 次，再一直对
const learner = (wrongs: number, points = 6, rights = 3) =>
  Array.from({ length: points }, (_, i) => [
    ...Array.from({ length: wrongs }, () => answer(`kp${i}`, false)),
    ...Array.from({ length: rights }, () => answer(`kp${i}`, true)),
  ]).flat();

describe("网格", () => {
  it("0.05 到 0.40，每隔 0.025", () => {
    expect(LEARN_GRID[0]).toBe(0.05);
    expect(LEARN_GRID.at(-1)).toBe(0.4);
    expect(LEARN_GRID).toHaveLength(15);
    expect(LEARN_GRID).toContain(BKT.learn);
  });
});

describe("fitLearnRate", () => {
  it("一题没答：落在全局值 0.15", () => {
    expect(fitLearnRate([])).toBe(BKT.learn);
  });

  it("答得少：被先验拉住，离 0.15 不远", () => {
    const l = fitLearnRate([answer("kp", false), answer("kp", true)]);
    expect(Math.abs(l - BKT.learn)).toBeLessThanOrEqual(0.05);
  });

  it("错一次就学会的学生比错三次才会的学得快", () => {
    const fast = fitLearnRate(learner(1));
    const slow = fitLearnRate(learner(3));
    expect(fast).toBeGreaterThan(BKT.learn);
    expect(slow).toBeLessThan(fast);
  });

  it("拟合出来的 ℓ 似然不比全局值差", () => {
    const rows = learner(1);
    expect(logLikelihood(rows, fitLearnRate(rows))).toBeGreaterThanOrEqual(
      logLikelihood(rows, BKT.learn)
    );
  });

  it("要过提示的题不算似然，但还是更新 M", () => {
    const plain = [answer("kp", true)];
    const withHint = [answer("kp", false, true), answer("kp", true)];
    expect(logLikelihood(withHint, 0.2)).not.toBe(logLikelihood(plain, 0.2));
    expect(logLikelihood([answer("kp", true, true)], 0.2)).toBe(0);
  });
});

describe("relearn", () => {
  it("换学习率后各点按新 ℓ 重算，学得快的 M 更高", () => {
    const graph = {
      builtAt: "",
      courseId: "c",
      edges: [],
      lessons: [{ fileIds: [], id: "l", index: 1, title: "l" }],
      name: "c",
      points: [
        {
          aliases: [],
          checkQuestions: [],
          definition: "",
          id: "kp",
          kind: "concept" as const,
          lessonId: "l",
          name: "kp",
          sources: [],
          status: "auto" as const,
        },
      ],
    };
    const attempts = [answer("kp", false).attempt, answer("kp", true).attempt];
    const state = {
      ...emptyLearnerState("u", "c"),
      nodes: {
        kp: relearn(
          {
            ...emptyLearnerState("u", "c"),
            nodes: {
              kp: {
                attempts,
                explained: false,
                helpOpportunities: 0,
                helpRequests: 0,
                M: 0,
                misconceptions: [],
                O: 0,
                review: null,
                stage: "not_covered" as const,
                stuckSessions: [],
                transferPassed: false,
              },
            },
          },
          graph,
          BKT.learn
        ).nodes.kp,
      },
    };
    expect(learnRateOf(state)).toBe(BKT.learn);
    const faster = relearn(state, graph, 0.3);
    expect(learnRateOf(faster)).toBe(0.3);
    expect(faster.nodes.kp.M).toBeGreaterThan(state.nodes.kp.M);
  });
});
