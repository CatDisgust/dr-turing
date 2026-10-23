import { describe, expect, it } from "vitest";
import type { CourseGraph, PendingQuestion } from "@/lib/types";
import { FULL_O, HALF_M } from "../config";
import { nodeLight } from "../light";
import { attemptFromGrading, pickQuestion } from "../question";
import { applyEvidence, emptyLearnerState } from "../update";

// D8 验收：画面二。检查题、变式题独立答对 → 半亮；隔天复习答对 → 全亮；
// 答错 → 不升级、记下误解；给提示后答对 → d = 0.5，要了答案后答对 → 只升 M

const point = {
  aliases: [],
  checkQuestions: [
    "检查题：两个人同时存钱为什么少一笔？",
    "变式题：库存扣减会不会出同样的问题？",
  ],
  definition: "两个事务读到同一旧值，各自写回，后写的覆盖先写的",
  id: "kp_lost",
  kind: "concept" as const,
  lessonId: "l2",
  name: "丢失更新",
  sources: [{ fileId: "f", lessonId: "l2", page: 21, quote: "q" }],
  status: "auto" as const,
};

const graph: CourseGraph = {
  builtAt: "",
  courseId: "c",
  edges: [],
  lessons: [{ fileIds: [], id: "l2", index: 2, title: "并发" }],
  name: "c",
  points: [point],
};

const TODAY = "2026-10-22T10:00:00Z";
const TOMORROW = "2026-10-23T10:00:00Z";

let seq = 0;
function answer(
  state: ReturnType<typeof emptyLearnerState>,
  session: string,
  at: string,
  help: PendingQuestion["help"],
  correct: boolean,
  misconception = ""
) {
  const node = state.nodes.kp_lost;
  const picked = pickQuestion(point, node, session, at);
  if (!picked) {
    throw new Error("没题可出");
  }
  const pending: PendingQuestion = {
    ...picked,
    askedAt: at,
    askedTurnId: "t",
    help,
    kpId: "kp_lost",
    sessionId: session,
  };
  seq += 1;
  const attempt = attemptFromGrading(
    pending,
    { correct, misconception, producedStep: true },
    { at, id: `a${seq}`, quote: `学生第 ${seq} 句`, turnId: `t${seq}` }
  );
  return {
    picked,
    state: applyEvidence(state, graph, "kp_lost", attempt),
  };
}

const start = () => emptyLearnerState("stu", "c");
const light = (s: ReturnType<typeof start>, session = "s1") =>
  nodeLight(s.nodes.kp_lost, session).light;

describe("出题顺序", () => {
  it("先检查题，独立答对后出变式题，都过了就不再出", () => {
    let s = start();
    let r = answer(s, "s1", TODAY, "none", true);
    expect(r.picked.kind).toBe("check");
    s = r.state;
    r = answer(s, "s1", TODAY, "none", true);
    expect(r.picked.kind).toBe("variant");
    expect(r.state.nodes.kp_lost.transferPassed).toBe(true);
    expect(pickQuestion(point, r.state.nodes.kp_lost, "s1", TODAY)).toBeNull();
  });

  it("变式题靠提示答对后，这次会话不再重复出", () => {
    let s = answer(start(), "s1", TODAY, "none", true).state;
    s = answer(s, "s1", TODAY, "hint", true).state;
    expect(s.nodes.kp_lost.transferPassed).toBe(false);
    expect(pickQuestion(point, s.nodes.kp_lost, "s1", TODAY)).toBeNull();
  });

  it("没有检查题的点不出题", () => {
    expect(
      pickQuestion({ ...point, checkQuestions: [] }, undefined, "s1", TODAY)
    ).toBeNull();
  });
});

describe("画面二", () => {
  it("当天独立答对检查题和变式题：半亮，原话留在证据里", () => {
    let s = answer(start(), "s1", TODAY, "none", true).state;
    s = answer(s, "s1", TODAY, "none", true).state;
    expect(light(s)).toBe("half");
    expect(s.nodes.kp_lost.O).toBeLessThan(FULL_O);
    expect(s.nodes.kp_lost.attempts.map((a) => a.quote)).toHaveLength(2);
  });

  it("隔天再答对复习题：全亮", () => {
    let s = answer(start(), "s1", TODAY, "none", true).state;
    s = answer(s, "s1", TODAY, "none", true).state;
    const r = answer(s, "s2", TOMORROW, "none", true);
    expect(r.picked.kind).toBe("review");
    expect(r.state.nodes.kp_lost.attempts.at(-1)?.type).toBe("review_correct");
    expect(light(r.state, "s2")).toBe("full");
  });

  it("答错：不升级，记下从他错答里提出的错误想法", () => {
    const s = answer(
      start(),
      "s1",
      TODAY,
      "none",
      false,
      "只有多线程才会丢失更新"
    ).state;
    const node = s.nodes.kp_lost;
    expect(node.M).toBeLessThan(HALF_M);
    expect(light(s)).toBe("dashed");
    expect(node.misconceptions[0].id).toBe("e1");
    expect(node.misconceptions[0].text).toBe("只有多线程才会丢失更新");
  });

  it("答错但看不出具体想法：不记错误想法；答对时就算批改给了想法也不记", () => {
    expect(
      answer(start(), "s1", TODAY, "none", false).state.nodes.kp_lost
        .misconceptions
    ).toEqual([]);
    expect(
      answer(start(), "s1", TODAY, "none", true, "随便什么").state.nodes.kp_lost
        .misconceptions
    ).toEqual([]);
  });

  it("给提示后答对：d = 0.5，O 只吃一半涨幅；要了答案后答对：只升 M", () => {
    const alone = answer(start(), "s1", TODAY, "none", true).state.nodes
      .kp_lost;
    const hinted = answer(start(), "s1", TODAY, "hint", true).state.nodes
      .kp_lost;
    const told = answer(start(), "s1", TODAY, "revealed", true).state.nodes
      .kp_lost;
    expect(hinted.attempts[0].d).toBe(0.5);
    expect(hinted.O).toBeCloseTo(alone.O / 2, 6);
    expect(told.M).toBeGreaterThan(0.3);
    expect(told.O).toBe(0);
    expect(hinted.helpRequests).toBe(0.5);
    expect(told.helpRequests).toBe(1);
  });

  it("答错留下误解，之后独立答对这个点的题就算修正；靠提示答对不算", () => {
    let s = answer(
      start(),
      "s1",
      TODAY,
      "none",
      false,
      "加了事务就不会丢失更新"
    ).state;
    s = answer(s, "s1", TODAY, "hint", true).state;
    expect(s.nodes.kp_lost.misconceptions[0].status).toBe("suspected");
    s = answer(s, "s1", TODAY, "none", true).state;
    expect(s.nodes.kp_lost.misconceptions[0].status).toBe("repaired");
  });

  it("要了提示的复习题答对不算隔天复习", () => {
    let s = answer(start(), "s1", TODAY, "none", true).state;
    s = answer(s, "s2", TOMORROW, "hint", true).state;
    expect(s.nodes.kp_lost.attempts.at(-1)?.type).toBe("check_correct");
  });
});

describe("出题前的预测（学生建模方案 D）", () => {
  it("批改时把题上的预测抄进证据", () => {
    const pending: PendingQuestion = {
      askedAt: "2026-10-23T00:00:00Z",
      askedTurnId: "t0",
      help: "none",
      kind: "check",
      kpId: "kp_lost",
      prediction: {
        baseline: 0.41,
        expectLike: null,
        learnRate: 0.15,
        M: 0.3,
        pCorrect: 0.41,
      },
      question: "q",
      questionId: "q1",
      sessionId: "s1",
    };
    const attempt = attemptFromGrading(
      pending,
      { correct: true, misconception: "", producedStep: true },
      { at: "2026-10-23T00:01:00Z", id: "a", quote: "x", turnId: "t1" }
    );
    expect(attempt.prediction?.pCorrect).toBe(0.41);
  });
});
