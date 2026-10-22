import { describe, expect, it } from "vitest";
import type { Attempt, ConceptChange, CourseGraph } from "@/lib/types";
import {
  betaEstimate,
  computeAbilities,
  describeAbilities,
  MIN_EVIDENCE,
} from "../abilities";
import {
  applyConceptChanges,
  emptyPersonalGraph,
  removeConcept,
} from "../personal";
import { applyEvidence, emptyLearnerState } from "../update";

const graph: CourseGraph = {
  builtAt: "",
  courseId: "c",
  edges: [],
  lessons: [{ fileIds: [], id: "l1", index: 1, title: "l" }],
  name: "c",
  points: [
    {
      aliases: ["Lost update"],
      checkQuestions: ["q"],
      definition: "d",
      id: "kp_lost",
      kind: "concept",
      lessonId: "l1",
      name: "丢失更新",
      sources: [],
      status: "auto",
    },
  ],
};

const change = (fields: Partial<ConceptChange>): ConceptChange => ({
  definition: "定义",
  level: "touched",
  name: "乐观锁",
  op: "add",
  quote: "原话",
  reason: "",
  sameAs: "",
  ...fields,
});

describe("个人图谱：课外概念", () => {
  it("新增的标未锚定，带原话和会话", () => {
    const g = applyConceptChanges(
      emptyPersonalGraph("stu"),
      [graph],
      [change({ quote: "乐观锁和这个有关吗" })],
      "s1",
      "t1"
    );
    expect(g.concepts).toEqual([
      expect.objectContaining({
        evidence: [{ at: "t1", quote: "乐观锁和这个有关吗", sessionId: "s1" }],
        id: "pc_1",
        status: "unanchored",
      }),
    ]);
    expect(g.log).toEqual([
      expect.objectContaining({ conceptId: "pc_1", op: "add" }),
    ]);
  });

  it("对得上课程知识点的不建（按 id、名字或别名）", () => {
    const g = applyConceptChanges(
      emptyPersonalGraph("stu"),
      [graph],
      [
        change({ sameAs: "kp_lost" }),
        change({ name: "丢失更新" }),
        change({ name: "lost update" }),
      ],
      "s1",
      "t1"
    );
    expect(g.concepts).toHaveLength(0);
  });

  it("同一个概念不重复：sameAs 或同名都并到已有的上", () => {
    let g = applyConceptChanges(
      emptyPersonalGraph("stu"),
      [graph],
      [change({})],
      "s1",
      "t1"
    );
    g = applyConceptChanges(
      g,
      [graph],
      [
        change({ level: "claimed", sameAs: "pc_1" }),
        change({ name: " 乐观锁 " }),
      ],
      "s2",
      "t2"
    );
    expect(g.concepts).toHaveLength(1);
    expect(g.concepts[0].evidence).toHaveLength(3);
    expect(g.concepts[0].level).toBe("claimed");
  });

  it("作废保留原因；学生删掉后 id 不复用", () => {
    let g = applyConceptChanges(
      emptyPersonalGraph("stu"),
      [graph],
      [change({}), change({ name: "悲观锁" })],
      "s1",
      "t1"
    );
    g = applyConceptChanges(
      g,
      [graph],
      [change({ op: "invalidate", reason: "学生说没学过", sameAs: "pc_1" })],
      "s2",
      "t2"
    );
    expect(g.concepts[0]).toMatchObject({
      note: "学生说没学过",
      status: "invalidated",
    });
    g = removeConcept(g, "pc_2", "t3");
    g = applyConceptChanges(g, [graph], [change({ name: "MVCC" })], "s3", "t4");
    expect(g.concepts.map((c) => c.id)).toEqual(["pc_1", "pc_3"]);
  });
});

let seq = 0;
function attempt(fields: Partial<Attempt>): Attempt {
  seq += 1;
  return {
    at: `2026-10-${String(10 + seq).padStart(2, "0")}T00:00:00.000Z`,
    correct: true,
    d: 1,
    hinted: false,
    id: `a${seq}`,
    producedStep: true,
    provisional: false,
    quote: `q${seq}`,
    sessionId: "s",
    source: "fast",
    turnId: `t${seq}`,
    type: "check_correct",
    ...fields,
  };
}

describe("底层能力", () => {
  it("贝叶斯比例：没证据时是默认值 0.5，证据多了才离开", () => {
    expect(betaEstimate(0, 0).value).toBe(0.5);
    expect(betaEstimate(1, 1).value).toBeCloseTo(0.6);
    expect(betaEstimate(20, 20).value).toBeGreaterThan(0.9);
    const few = betaEstimate(1, 1);
    const many = betaEstimate(10, 20);
    expect(few.high - few.low).toBeGreaterThan(many.high - many.low);
  });

  it("三项各从对应的证据算，证据不够时不确定", () => {
    let state = emptyLearnerState("stu", "c");
    for (const a of [
      attempt({ d: 0.5, hinted: true, producedStep: false }),
      attempt({}),
      attempt({ producedStep: false }),
      attempt({ questionKind: "review", type: "review_correct" }),
      attempt({ correct: false, questionKind: "review", type: "check_wrong" }),
    ]) {
      state = applyEvidence(state, graph, "kp_lost", a);
    }
    const [self, independence, retention] = computeAbilities([state]);
    expect([self.k, self.n]).toEqual([3, 5]);
    expect([independence.k, independence.n]).toEqual([4, 5]);
    expect([retention.k, retention.n]).toEqual([1, 2]);
    expect(self.certain).toBe(true);
    expect(retention.certain).toBe(MIN_EVIDENCE <= 2);
    expect(self.evidence[0].quote).toBe("q5");
  });

  it("交给导师的话：证据不够的不说", () => {
    let state = emptyLearnerState("stu", "c");
    expect(describeAbilities(computeAbilities([state]))).toBeNull();
    for (let i = 0; i < 6; i += 1) {
      state = applyEvidence(
        state,
        graph,
        "kp_lost",
        attempt({ d: 0.5, hinted: true, producedStep: false })
      );
    }
    const text = describeAbilities(computeAbilities([state]));
    expect(text).toContain("提示拆得更小");
    expect(text).toContain("先给一个具体例子");
  });
});
