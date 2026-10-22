import { describe, expect, it } from "vitest";
import type { Attempt, CourseGraph, LearnerState } from "@/lib/types";
import { planTurn } from "../planner";
import { applyEvidence, emptyLearnerState } from "../update";

// D9a：规划器是纯规则。同一个问题，基础好的 A 和基础弱的 B 拿到的 plan 至少 3 项不同；
// 同样的状态重复规划，结果完全一样

const point = (id: string, kind: "concept" | "procedure" = "concept") => ({
  aliases: [],
  checkQuestions: [`${id} 检查题`],
  definition: `${id} 定义`,
  id,
  kind,
  lessonId: "l1",
  name: id,
  sources: [{ fileId: "f", lessonId: "l1", page: 1, quote: "q" }],
  status: "auto" as const,
});

// 共享状态 → 竞争条件 → 互斥锁
const graph: CourseGraph = {
  builtAt: "",
  courseId: "c",
  edges: [
    { from: "kp_state", status: "tentative", to: "kp_race", type: "prereq" },
    { from: "kp_race", status: "tentative", to: "kp_mutex", type: "prereq" },
  ],
  lessons: [{ fileIds: [], id: "l1", index: 1, title: "并发" }],
  name: "c",
  points: [point("kp_state"), point("kp_race"), point("kp_mutex", "procedure")],
};

let seq = 0;
function evidence(
  state: LearnerState,
  kpId: string,
  fields: Partial<Attempt>
): LearnerState {
  seq += 1;
  return applyEvidence(state, graph, kpId, {
    at: "2026-10-20T10:00:00Z",
    correct: true,
    d: 1,
    hinted: false,
    id: `a${seq}`,
    producedStep: true,
    provisional: false,
    quote: "原话",
    sessionId: "old",
    source: "slow",
    turnId: `t${seq}`,
    type: "check_correct",
    ...fields,
  });
}

// A：先修都理解了
function studentA() {
  let s = emptyLearnerState("A", "c");
  s = evidence(s, "kp_state", {});
  s = evidence(s, "kp_race", {});
  return s;
}

// B：先修没证据，互斥锁上答错过一次、要过答案，留下一个误解
function studentB() {
  let s = emptyLearnerState("B", "c");
  s = evidence(s, "kp_mutex", {
    correct: false,
    misconception: "kp_mutex 的错误想法",
    type: "check_wrong",
  });
  s = evidence(s, "kp_mutex", { d: 0, hinted: true });
  return s;
}

const plan = (state: LearnerState) =>
  planTurn({ graph, kpId: "kp_mutex", sessionId: "now", state });

describe("规划器", () => {
  it("A、B 同问互斥锁：start_from / disclosure / elicits / 误解至少 3 项不同", () => {
    const a = plan(studentA());
    const b = plan(studentB());
    expect(a.start_from).toEqual(["kp_race", "kp_state"]);
    expect(b.start_from).toEqual([]);
    expect(a.check_misconception_first).toBeUndefined();
    expect(b.check_misconception_first).toBe("kp_mutex 的错误想法");
    const differ = [
      JSON.stringify(a.start_from) !== JSON.stringify(b.start_from),
      a.disclosure_level !== b.disclosure_level,
      a.elicits_production !== b.elicits_production,
      a.check_misconception_first !== b.check_misconception_first,
    ].filter(Boolean).length;
    expect(differ).toBeGreaterThanOrEqual(3);
  });

  it("同样的状态规划 5 次，结果完全一样", () => {
    const s = studentB();
    const first = plan(s);
    for (let i = 0; i < 4; i += 1) {
      expect(plan(s)).toEqual(first);
    }
  });

  it("刚接触、没有已理解的先修：讲全，不逼产出；步骤类用例题", () => {
    const p = plan(emptyLearnerState("C", "c"));
    expect(p.next_action).toBe("teach");
    expect(p.prompt).toBe("aha");
    expect(p.disclosure_level).toBe("full");
    expect(p.elicits_production).toBe(false);
    expect(p.action_type).toBe("worked_example");
  });

  it("要了提示走最小提示；要答案就全揭示", () => {
    const hint = planTurn({
      graph,
      kpId: "kp_mutex",
      sessionId: "now",
      signal: "hint",
      state: studentA(),
    });
    expect([hint.prompt, hint.disclosure_level]).toEqual(["min_hint", "hint"]);
    const told = planTurn({
      graph,
      kpId: "kp_mutex",
      sessionId: "now",
      signal: "just_tell_me",
      state: studentA(),
    });
    expect([told.prompt, told.disclosure_level, told.reveals_answer]).toEqual([
      "aha",
      "full",
      true,
    ]);
  });

  it("学生说过喜欢看代码，表征就用代码", () => {
    const s = studentA();
    s.profile.statedPreferences = [
      { quote: "给我看代码吧", text: "喜欢看代码" },
    ];
    expect(
      planTurn({ graph, kpId: "kp_race", sessionId: "now", state: s })
        .representation
    ).toBe("code");
  });
});
