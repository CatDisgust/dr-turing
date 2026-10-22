import { describe, expect, it } from "vitest";
import type { Attempt, CourseGraph, LearnerState } from "@/lib/types";
import { BKT } from "../config";
import { plannerContext } from "../context";
import { nodeLight } from "../light";
import { bktUpdate } from "../mastery";
import {
  applyEvidence,
  applySignal,
  emptyLearnerState,
  markExplained,
  retractEvidence,
} from "../update";

// D6 验收：主文档更新表每条事件各一条单测；随机序列下 O ≤ M 恒成立；
// 要了答案后答对只升 M；先修只会被标“待检查”，不会被扣分

const point = (id: string, kind: "concept" | "memory" = "concept") => ({
  aliases: [],
  checkQuestions: [`${id} 的检查题`],
  definition: `${id} 的定义`,
  id,
  kind,
  lessonId: "l1",
  misconceptions: [`${id} 的误解`],
  name: id,
  sources: [{ fileId: "f", lessonId: "l1", page: 1, quote: "q" }],
  status: "auto" as const,
});

// 共享状态 → 竞争条件 → 互斥锁；竞争条件和死锁易混
const graph: CourseGraph = {
  builtAt: "",
  courseId: "c",
  edges: [
    { from: "kp_state", status: "tentative", to: "kp_race", type: "prereq" },
    { from: "kp_thread", status: "tentative", to: "kp_state", type: "prereq" },
    { from: "kp_race", status: "tentative", to: "kp_mutex", type: "prereq" },
    {
      from: "kp_race",
      status: "tentative",
      to: "kp_deadlock",
      type: "confusable",
    },
  ],
  lessons: [{ fileIds: [], id: "l1", index: 1, title: "并发" }],
  name: "c",
  points: [
    point("kp_thread", "memory"),
    point("kp_state"),
    point("kp_race"),
    point("kp_mutex"),
    point("kp_deadlock"),
  ],
};

let seq = 0;
function attempt(fields: Partial<Attempt>): Attempt {
  seq += 1;
  return {
    at: "2026-10-22T10:00:00Z",
    correct: true,
    d: 1,
    hinted: false,
    id: `a${seq}`,
    producedStep: true,
    provisional: true,
    quote: "学生原话",
    sessionId: "s1",
    source: "fast",
    turnId: `t${seq}`,
    type: "check_correct",
    ...fields,
  };
}

function apply(state: LearnerState, kpId: string, fields: Partial<Attempt>) {
  return applyEvidence(state, graph, kpId, attempt(fields));
}

const start = () => emptyLearnerState("stu", "c");
const H = (state: LearnerState, kpId: string) =>
  state.nodes[kpId].helpRequests / state.nodes[kpId].helpOpportunities;

describe("更新表：每种事件", () => {
  it("无提示独立做对：M 按答对更新，O 吃满涨幅（d = 1），H 下降", () => {
    let s = apply(start(), "kp_race", { d: 0.5, hinted: true });
    const before = s.nodes.kp_race;
    s = apply(s, "kp_race", {});
    const node = s.nodes.kp_race;
    expect(node.M).toBeCloseTo(bktUpdate(before.M, true), 12);
    expect(node.O).toBeCloseTo(before.O + (node.M - before.M), 12);
    expect(H(s, "kp_race")).toBeLessThan(0.5);
  });

  it("小提示后做对：O 只吃一半涨幅（d = 0.5），H 小幅上升", () => {
    const s = apply(start(), "kp_race", { d: 0.5, hinted: true });
    const node = s.nodes.kp_race;
    expect(node.O).toBeCloseTo(0.5 * (node.M - BKT.prior), 12);
    expect(H(s, "kp_race")).toBe(0.5);
  });

  it("答案被揭示后照着做对：只升 M，而且学习率减半；O 不动；H 上升", () => {
    const s = apply(start(), "kp_race", { d: 0, hinted: true });
    const node = s.nodes.kp_race;
    const full = bktUpdate(BKT.prior, true);
    const half = bktUpdate(BKT.prior, true, { ...BKT, learn: BKT.learn / 2 });
    expect(node.M).toBeCloseTo(half, 12);
    expect(node.M).toBeLessThan(full);
    expect(node.M).toBeGreaterThan(BKT.prior);
    expect(node.O).toBe(0);
    expect(H(s, "kp_race")).toBe(1);
  });

  it("做错并匹配误解：M 降、O 不变（除非 M 掉到 O 以下，O 跟着压到 M）；第一次疑似，第二次确认；之后独立做对记为已修正", () => {
    let s = apply(start(), "kp_race", {});
    const before = s.nodes.kp_race;
    s = apply(s, "kp_race", {
      correct: false,
      misconceptionId: "own-copy",
      quote: "每个线程有自己的 count 副本",
      type: "check_wrong",
    });
    expect(s.nodes.kp_race.M).toBeLessThan(before.M);
    expect(s.nodes.kp_race.O).toBe(Math.min(before.O, s.nodes.kp_race.M));
    expect(s.nodes.kp_race.misconceptions).toEqual([
      {
        id: "own-copy",
        lastQuote: "每个线程有自己的 count 副本",
        seen: 1,
        status: "suspected",
      },
    ]);
    s = apply(s, "kp_race", {
      correct: false,
      misconceptionId: "own-copy",
      type: "check_wrong",
    });
    expect(s.nodes.kp_race.misconceptions[0].status).toBe("confirmed");
    s = apply(s, "kp_race", { misconceptionId: "own-copy" });
    expect(s.nodes.kp_race.misconceptions[0].status).toBe("repaired");
  });

  it("隔天复习独立做对：O 向 M 靠拢，复习间隔拉长", () => {
    let s = apply(start(), "kp_race", { at: "2026-10-22T10:00:00Z" });
    const first = s.nodes.kp_race;
    s = apply(s, "kp_race", {
      at: "2026-10-25T10:00:00Z",
      type: "review_correct",
    });
    const node = s.nodes.kp_race;
    // 比普通独立做对涨得多：至少补上一半 M 和 O 的差距
    expect(node.O).toBeGreaterThanOrEqual(
      first.O + 0.5 * (node.M - first.O) - 1e-12
    );
    expect(node.O).toBeLessThanOrEqual(node.M);
    const gap = (r: typeof node.review) =>
      r ? r.nextReviewAt - (r.lastReviewAt ?? 0) : 0;
    expect(gap(node.review)).toBeGreaterThan(gap(first.review));
  });

  it("变式题做对：d = 1，迁移题记为通过；有提示的不算", () => {
    let s = apply(start(), "kp_race", {
      d: 0.5,
      hinted: true,
      type: "transfer_correct",
    });
    expect(s.nodes.kp_race.transferPassed).toBe(false);
    const before = s.nodes.kp_race;
    s = apply(s, "kp_race", { type: "transfer_correct" });
    const node = s.nodes.kp_race;
    expect(node.transferPassed).toBe(true);
    expect(node.O).toBeCloseTo(before.O + (node.M - before.M), 12);
  });

  it("“说懂了”和求助只记证据，不动 M、O", () => {
    const s = apply(start(), "kp_race", {
      correct: undefined,
      type: "said_understood",
    });
    expect(s.nodes.kp_race.M).toBe(BKT.prior);
    expect(s.nodes.kp_race.O).toBe(0);
    expect(nodeLight(s.nodes.kp_race, "s1").light).toBe("dashed");
  });
});

// 实现规划的风险表：画面二要几道题才能全亮，D6 用单测算准
describe("全亮要几道题", () => {
  it("只做检查题，独立答对多少次都到不了全亮：O 的上限是 1 − 先验 = 0.7", () => {
    let s = start();
    for (let k = 0; k < 20; k += 1) {
      s = apply(s, "kp_race", {});
    }
    expect(s.nodes.kp_race.O).toBeLessThan(0.7);
    expect(nodeLight(s.nodes.kp_race).light).toBe("half");
  });

  it("画面二当天：有提示的旧证据（半亮）+ 独立答对检查题 + 独立答对变式题，仍是半亮", () => {
    let s = apply(start(), "kp_race", {
      at: "2026-10-12T10:00:00Z",
      d: 0.5,
      hinted: true,
      provisional: false,
      sessionId: "old",
    });
    expect(nodeLight(s.nodes.kp_race).light).toBe("half");
    s = apply(s, "kp_race", {});
    s = apply(s, "kp_race", { type: "transfer_correct" });
    expect(s.nodes.kp_race.O).toBeLessThan(0.7);
    expect(nodeLight(s.nodes.kp_race).light).toBe("half");
  });

  it("画面二要全亮，得预置一次“隔天复习独立做对”", () => {
    let s = apply(start(), "kp_race", {
      at: "2026-10-12T10:00:00Z",
      d: 0.5,
      hinted: true,
      provisional: false,
      sessionId: "old",
    });
    s = apply(s, "kp_race", { at: "2026-10-12T10:05:00Z", sessionId: "old" });
    s = apply(s, "kp_race", {
      at: "2026-10-13T10:00:00Z",
      sessionId: "old2",
      type: "review_correct",
    });
    expect(s.nodes.kp_race.O).toBeGreaterThanOrEqual(0.7);
    expect(nodeLight(s.nodes.kp_race).light).toBe("full");
  });

  it("从零开始：独立答对两道题，隔天复习再答对才全亮；只答对一道再复习不够", () => {
    const review = {
      at: "2026-10-23T10:00:00Z",
      type: "review_correct" as const,
    };
    const one = apply(apply(start(), "kp_race", {}), "kp_race", review);
    expect(nodeLight(one.nodes.kp_race).light).toBe("half");
    const two = apply(
      apply(apply(start(), "kp_race", {}), "kp_race", {}),
      "kp_race",
      review
    );
    expect(nodeLight(two.nodes.kp_race).light).toBe("full");
  });
});

describe("随机序列：O ≤ M 恒成立", () => {
  it("2000 条随机证据序列", () => {
    // 固定种子的线性同余，结果可复现
    let x = 5348;
    const rand = () => {
      x = (x * 1_103_515_245 + 12_345) % 2_147_483_648;
      return x / 2_147_483_648;
    };
    const types = [
      "check_correct",
      "review_correct",
      "transfer_correct",
      "self_explained",
    ] as const;
    for (let run = 0; run < 2000; run += 1) {
      let s = start();
      const n = 1 + Math.floor(rand() * 15);
      for (let k = 0; k < n; k += 1) {
        const d = ([1, 0.5, 0] as const)[Math.floor(rand() * 3)];
        const graded = rand() < 0.85;
        s = apply(s, "kp_race", {
          at: new Date(
            Date.UTC(2026, 9, 22) + k * rand() * 4 * 86_400_000
          ).toISOString(),
          correct: graded ? rand() < 0.6 : undefined,
          d,
          hinted: d !== 1,
          type: graded
            ? types[Math.floor(rand() * types.length)]
            : "said_understood",
        });
        const node = s.nodes.kp_race;
        expect(node.O).toBeLessThanOrEqual(node.M + 1e-12);
        expect(node.O).toBeGreaterThanOrEqual(0);
        expect(node.M).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("保守的先修传播", () => {
  it("连错两次：没证据的先修标“待检查”，有证据的先修不标；先修的 M、O 一点不动", () => {
    let s = apply(start(), "kp_mutex", {});
    // 互斥锁的先修是竞争条件；给竞争条件一条证据，它就不该被标
    s = apply(s, "kp_race", { correct: false, type: "check_wrong" });
    const raceBefore = s.nodes.kp_race;
    s = apply(s, "kp_mutex", { correct: false, type: "check_wrong" });
    s = apply(s, "kp_mutex", { correct: false, type: "check_wrong" });
    expect(s.nodes.kp_race.checkFlag).toBeUndefined();
    expect(s.nodes.kp_race.M).toBe(raceBefore.M);
    expect(s.nodes.kp_race.O).toBe(raceBefore.O);

    // 竞争条件连错两次：它的先修“共享状态”没证据 → 标待检查，但还是先验值
    s = apply(s, "kp_race", { correct: false, type: "check_wrong" });
    expect(s.nodes.kp_state.checkFlag).toBe("prereq_suspect");
    expect(s.nodes.kp_state.M).toBe(BKT.prior);
    expect(s.nodes.kp_state.O).toBe(0);
    // 只往回一跳，不连坐两跳外的点
    expect(s.nodes.kp_thread).toBeUndefined();
  });

  it("只错一次不标；先修有了自己的证据后标记清掉", () => {
    let s = apply(start(), "kp_race", { correct: false, type: "check_wrong" });
    expect(s.nodes.kp_state).toBeUndefined();
    s = apply(s, "kp_race", { correct: false, type: "check_wrong" });
    expect(s.nodes.kp_state.checkFlag).toBe("prereq_suspect");
    s = apply(s, "kp_state", {});
    expect(s.nodes.kp_state.checkFlag).toBeUndefined();
  });
});

describe("撤销、讲解、投入度", () => {
  it("慢路径撤掉一条暂定证据，节点回到加它之前", () => {
    const one = apply(start(), "kp_race", { d: 0.5, hinted: true });
    const extra = attempt({});
    const two = applyEvidence(one, graph, "kp_race", extra);
    const back = retractEvidence(two, graph, "kp_race", extra.id);
    expect(back.nodes.kp_race).toEqual(one.nodes.kp_race);
  });

  it("讲解算接收：只改阶段，不动 M、O", () => {
    const s = markExplained(start(), graph, "kp_race");
    expect(s.nodes.kp_race.stage).toBe("explained");
    expect(s.nodes.kp_race.M).toBe(BKT.prior);
    expect(s.nodes.kp_race.O).toBe(0);
  });

  it("放弃、直接告诉我、跳题各记一笔；独立做对后清零", () => {
    let s = applySignal(start(), "give_up", "t");
    s = applySignal(s, "skip", "t");
    s = applySignal(s, "just_tell_me", "t");
    s = applySignal(s, "hint", "t");
    expect(s.engagement).toMatchObject({
      giveUps: 1,
      justTellMe: 1,
      skippedQuestions: 1,
    });
    s = apply(s, "kp_race", {});
    expect(s.engagement).toMatchObject({
      giveUps: 0,
      justTellMe: 0,
      skippedQuestions: 0,
    });
  });
});

describe("亮度和规划器切片", () => {
  it("M ≥ 0.6 半亮，O ≥ 0.7 全亮，进度环 = O / 0.7，暂定证据标出来", () => {
    let s = apply(start(), "kp_race", {});
    expect(nodeLight(s.nodes.kp_race).light).toBe("half");
    expect(nodeLight(s.nodes.kp_race).provisional).toBe(true);
    s = apply(s, "kp_race", { provisional: false });
    s = apply(s, "kp_race", {
      at: "2026-10-23T10:00:00Z",
      provisional: false,
      type: "review_correct",
    });
    const lit = nodeLight(s.nodes.kp_race);
    expect(lit.light).toBe("full");
    expect(lit.ring).toBe(1);
    expect(nodeLight(undefined).light).toBe("gray");
  });

  it("切片：目标 + 一跳、两跳先修 + 易混点", () => {
    const s = apply(start(), "kp_state", {});
    const ctx = plannerContext(graph, s, "kp_mutex", "s1");
    expect(ctx.target.id).toBe("kp_mutex");
    expect(ctx.prereqs.map((p) => [p.id, p.hops])).toEqual([
      ["kp_race", 1],
      ["kp_state", 2],
    ]);
    expect(ctx.prereqs[1].hasEvidence).toBe(true);
    expect(plannerContext(graph, s, "kp_race").confusable[0].id).toBe(
      "kp_deadlock"
    );
  });
});
