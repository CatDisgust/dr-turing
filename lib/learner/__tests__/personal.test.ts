import { describe, expect, it } from "vitest";
import type {
  Attempt,
  ConceptChange,
  ConceptEvent,
  CourseGraph,
} from "@/lib/types";
import {
  betaEstimate,
  computeAbilities,
  describeAbilities,
  MIN_EVIDENCE,
} from "../abilities";
import {
  eventsFromLegacy,
  identityEvents,
  identityPool,
  identityQuestions,
  invalidateDraft,
  mergeDraft,
  nextConceptSeq,
  personalFromEvents,
  similar,
  splitDraft,
  stamp,
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

// 按顺序把一批变更认完人、写进日志，返回新的日志
let eid = 0;
function review(
  events: ConceptEvent[],
  changes: ConceptChange[],
  sessionId: string,
  now: string,
  answers: Record<number, string> = {}
): ConceptEvent[] {
  const personal = personalFromEvents("stu", events);
  const pool = identityPool(personal, [graph]);
  const questions = identityQuestions(changes, pool);
  const drafts = identityEvents(
    changes,
    pool,
    questions,
    new Map(Object.entries(answers).map(([k, v]) => [Number(k), v])),
    nextConceptSeq(events)
  );
  return [
    ...events,
    ...stamp(drafts, { now, sessionId, studentId: "stu" }, () => {
      eid += 1;
      return `e${eid}`;
    }),
  ];
}

const T1 = "2026-10-23T01:00:00.000Z";
const T2 = "2026-10-23T02:00:00.000Z";
const T3 = "2026-10-23T03:00:00.000Z";

describe("个人知识库：先认人再记账", () => {
  it("新增的标未锚定，带原话和会话", () => {
    const g = personalFromEvents(
      "stu",
      review([], [change({ quote: "乐观锁和这个有关吗" })], "s1", T1)
    );
    expect(g.concepts).toEqual([
      expect.objectContaining({
        aliases: [],
        evidence: [{ at: T1, quote: "乐观锁和这个有关吗", sessionId: "s1" }],
        id: "pc_1",
        status: "unanchored",
      }),
    ]);
    expect(g.log).toEqual([
      expect.objectContaining({ conceptId: "pc_1", op: "add" }),
    ]);
  });

  it("字面像的先列候选：Agent harness 和带括注的那个、和课程知识点", () => {
    const events = review(
      [],
      [change({ name: "Agent harness（AI 智能体外壳程序）" })],
      "s1",
      T1
    );
    const pool = identityPool(personalFromEvents("stu", events), [graph]);
    const qs = identityQuestions(
      [
        change({ name: "Agent harness" }),
        change({ name: "lost updates" }),
        change({ name: "向量数据库" }),
      ],
      pool
    );
    expect(qs.map((q) => [q.index, q.candidates.map((c) => c.id)])).toEqual([
      [0, ["pc_1"]],
      [1, ["kp_lost"]],
    ]);
  });

  it("认出来是同一个：只多一条证据、多一个别名，不多一个概念", () => {
    let events = review(
      [],
      [change({ name: "Agent harness（AI 智能体外壳程序）" })],
      "s1",
      T1
    );
    events = review(
      events,
      [change({ level: "claimed", name: "Agent harness" })],
      "s2",
      T2,
      { 0: "pc_1" }
    );
    const g = personalFromEvents("stu", events);
    expect(g.concepts).toHaveLength(1);
    expect(g.concepts[0]).toMatchObject({
      aliases: ["Agent harness"],
      level: "claimed",
      name: "Agent harness（AI 智能体外壳程序）",
    });
    expect(g.concepts[0].evidence).toHaveLength(2);
  });

  it("同一次复盘里前后两条是同一个，也只建一个", () => {
    const events = review(
      [],
      [
        change({ name: "Agent harness（外壳）" }),
        change({ name: "Agent harness" }),
      ],
      "s1",
      T1,
      { 1: "#0" }
    );
    expect(personalFromEvents("stu", events).concepts).toHaveLength(1);
  });

  it("Claude 说不是同一个、或者答了不在候选里的 id，就建新的", () => {
    let events = review([], [change({ name: "乐观锁" })], "s1", T1);
    events = review(
      events,
      [change({ name: "乐观锁定" }), change({ name: "悲观锁" })],
      "s2",
      T2,
      {
        0: "new",
        1: "pc_99",
      }
    );
    expect(personalFromEvents("stu", events).concepts.map((c) => c.id)).toEqual(
      ["pc_1", "pc_2", "pc_3"]
    );
  });

  it("认出来是课程知识点：只在知识点上记一条出处，不建课外概念", () => {
    const events = review(
      [],
      [change({ name: "lost updates", quote: "就是 lost updates 吧" })],
      "s1",
      T1,
      {
        0: "kp_lost",
      }
    );
    const g = personalFromEvents("stu", events);
    expect(g.concepts).toHaveLength(0);
    expect(g.courseMentions?.kp_lost).toEqual([
      { at: T1, quote: "就是 lost updates 吧", sessionId: "s1" },
    ]);
  });

  it("作废保留原因；再被提到就恢复；编号不复用", () => {
    let events = review([], [change({}), change({ name: "悲观锁" })], "s1", T1);
    events = review(
      events,
      [change({ op: "invalidate", reason: "学生说没学过", sameAs: "pc_1" })],
      "s2",
      T2
    );
    expect(personalFromEvents("stu", events).concepts[0]).toMatchObject({
      note: "学生说没学过",
      status: "invalidated",
    });
    events = [
      ...events,
      ...stamp(
        [invalidateDraft("pc_2", "学生说记错了")],
        { now: T2, sessionId: null, studentId: "stu" },
        () => "x"
      ),
    ];
    events = review(events, [change({ name: "MVCC" })], "s3", T3);
    expect(
      personalFromEvents("stu", events).concepts.map((c) => [c.id, c.status])
    ).toEqual([
      ["pc_1", "invalidated"],
      ["pc_2", "invalidated"],
      ["pc_3", "unanchored"],
    ]);
  });

  it("合并之后证据和叫法都归到一个上；拆开又分回两个，证据一条不丢", () => {
    let events = review(
      [],
      [change({ name: "Agent harness" }), change({ name: "智能体外壳" })],
      "s1",
      T1
    );
    const [merge] = stamp(
      [mergeDraft("pc_2", "pc_1")],
      { now: T2, sessionId: null, studentId: "stu" },
      () => "m1"
    );
    events = [...events, merge];
    let g = personalFromEvents("stu", events);
    expect(g.concepts).toHaveLength(1);
    expect(g.concepts[0]).toMatchObject({
      aliases: ["智能体外壳"],
      id: "pc_1",
      name: "Agent harness",
    });
    expect(g.concepts[0].merged).toEqual([
      { from: "pc_2", mergeId: "m1", name: "智能体外壳" },
    ]);
    expect(g.concepts[0].evidence).toHaveLength(2);
    events = [
      ...events,
      ...stamp(
        [splitDraft(merge)],
        { now: T3, sessionId: null, studentId: "stu" },
        () => "s1"
      ),
    ];
    g = personalFromEvents("stu", events);
    expect(g.concepts.map((c) => [c.id, c.name, c.evidence.length])).toEqual([
      ["pc_1", "Agent harness", 1],
      ["pc_2", "智能体外壳", 1],
    ]);
  });

  it("旧数据（按名字认人的那版）导进日志，算出来一样", () => {
    const legacy = {
      concepts: [
        {
          aliases: [],
          createdAt: T1,
          definition: "d",
          evidence: [
            { at: T1, quote: "q1", sessionId: "s1" },
            { at: T2, quote: "q2", sessionId: "s2" },
          ],
          id: "pc_3",
          level: "claimed" as const,
          name: "乐观锁",
          note: "没学过",
          status: "invalidated" as const,
        },
      ],
      log: [],
      studentId: "stu",
    };
    let n = 0;
    const g = personalFromEvents(
      "stu",
      eventsFromLegacy(legacy, () => {
        n += 1;
        return `l${n}`;
      })
    );
    expect(g.concepts[0]).toMatchObject({
      id: "pc_3",
      level: "claimed",
      note: "没学过",
      status: "invalidated",
    });
    expect(g.concepts[0].evidence).toHaveLength(2);
  });

  it("字面相似：包含、二元组", () => {
    expect(similar("Agent harness", "agent-harness（AI 外壳）")).toBe(true);
    expect(similar("乐观锁", "悲观锁")).toBe(true); // 字面像，交给 Claude 判断不是同一个
    expect(similar("死锁", "向量数据库")).toBe(false);
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
