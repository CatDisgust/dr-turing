import { describe, expect, it } from "vitest";
import type { Attempt, CourseGraph } from "@/lib/types";
import { nodeLight } from "../light";
import { applyReview, sessionReport } from "../review";
import { applyEvidence, emptyLearnerState } from "../update";

// D9 验收：复核能改写快路径的结论并留痕；会话报告显示揭示率、自产步骤比例、O 增量

const point = (id: string) => ({
  aliases: [],
  checkQuestions: [`${id} 的检查题`],
  definition: `${id} 的定义`,
  id,
  kind: "concept" as const,
  lessonId: "l1",
  misconceptions: [],
  name: `点${id}`,
  sources: [],
  status: "auto" as const,
});

const graph: CourseGraph = {
  builtAt: "",
  courseId: "c",
  edges: [],
  lessons: [{ fileIds: [], id: "l1", index: 1, title: "l" }],
  name: "c",
  points: [point("a"), point("b")],
};

let seq = 0;
function attempt(fields: Partial<Attempt>): Attempt {
  seq += 1;
  return {
    at: `2026-10-22T0${seq % 10}:00:00.000Z`,
    correct: true,
    d: 1,
    hinted: false,
    id: `t${seq}`,
    producedStep: true,
    provisional: true,
    quote: `原话${seq}`,
    sessionId: "s1",
    source: "fast",
    turnId: `u${seq}`,
    type: "check_correct",
    ...fields,
  };
}

function seeded() {
  let state = emptyLearnerState("stu", "c");
  const a1 = attempt({});
  const a2 = attempt({ d: 0.5, hinted: true, producedStep: false });
  const b1 = attempt({ d: 0, hinted: true, producedStep: false });
  const old = attempt({ provisional: false, sessionId: "s0" });
  state = applyEvidence(state, graph, "a", old);
  state = applyEvidence(state, graph, "a", a1);
  state = applyEvidence(state, graph, "a", a2);
  state = applyEvidence(state, graph, "b", b1);
  return { a1, a2, b1, old, state };
}

describe("applyReview", () => {
  it("推翻的证据撤掉、M 退回，原因留在节点上", () => {
    const { a1, state } = seeded();
    const before = state.nodes.a.M;
    const out = applyReview(
      state,
      graph,
      "s1",
      [{ attemptId: a1.id, reason: "照抄了导师上一句", verdict: "retract" }],
      "2026-10-22T10:00:00.000Z"
    );
    expect(out.state.nodes.a.attempts.map((a) => a.id)).not.toContain(a1.id);
    expect(out.state.nodes.a.M).toBeLessThan(before);
    expect(out.state.nodes.a.retracted?.[0]).toMatchObject({
      attempt: { id: a1.id },
      reason: "照抄了导师上一句",
    });
    expect(out.retracted).toEqual([
      { kpId: "a", name: "点a", quote: a1.quote, reason: "照抄了导师上一句" },
    ]);
  });

  it("确认的和没提到的都转正，别的会话不动", () => {
    const { a2, state } = seeded();
    const out = applyReview(
      state,
      graph,
      "s1",
      [{ attemptId: a2.id, reason: "", verdict: "confirm" }],
      "now"
    );
    expect(out.confirmed).toBe(3);
    const all = Object.values(out.state.nodes).flatMap((n) => n.attempts);
    expect(all.every((a) => !a.provisional)).toBe(true);
    expect(nodeLight(out.state.nodes.a).provisional).toBe(false);
    // 转正不改数
    expect(out.state.nodes.a.M).toBe(state.nodes.a.M);
  });

  it("只复核指定会话的暂定证据", () => {
    const { state } = seeded();
    const out = applyReview(state, graph, "other", [], "now");
    expect(out.confirmed).toBe(0);
    expect(
      out.state.nodes.a.attempts.filter((a) => a.provisional)
    ).toHaveLength(2);
  });

  it("撤销后再转正，后面的状态更新还留着撤销记录", () => {
    const { a1, state } = seeded();
    const out = applyReview(
      state,
      graph,
      "s1",
      [{ attemptId: a1.id, reason: "r", verdict: "retract" }],
      "now"
    );
    const later = applyEvidence(
      out.state,
      graph,
      "a",
      attempt({ sessionId: "s2" })
    );
    expect(later.nodes.a.retracted).toHaveLength(1);
  });
});

describe("sessionReport", () => {
  it("步数、自己做的步数、揭示率、自产比例、O 增量", () => {
    const { state } = seeded();
    const out = applyReview(state, graph, "s1", [], "now");
    const report = sessionReport({
      confirmed: out.confirmed,
      graph,
      leaks: 1,
      now: "now",
      retracted: out.retracted,
      sessionId: "s1",
      state: out.state,
    });
    expect(report.steps).toBe(3);
    expect(report.ownSteps).toBe(1);
    expect(report.revealRate).toBeCloseTo(1 / 3);
    expect(report.selfProducedRate).toBeCloseTo(1 / 3);
    expect(report.leaks).toBe(1);
    const a = report.oGain.find((g) => g.kpId === "a");
    expect(a?.after).toBeGreaterThan(a?.before ?? 1);
    // 只看答案后答对：O 不涨
    const b = report.oGain.find((g) => g.kpId === "b");
    expect(b?.after).toBe(b?.before);
  });

  it("没做题时比例为空", () => {
    const report = sessionReport({
      confirmed: 0,
      graph,
      leaks: 0,
      now: "now",
      retracted: [],
      sessionId: "s1",
      state: emptyLearnerState("stu", "c"),
    });
    expect(report.steps).toBe(0);
    expect(report.revealRate).toBeNull();
  });
});
