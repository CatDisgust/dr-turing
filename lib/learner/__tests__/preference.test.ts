import { describe, expect, it } from "vitest";
import type { Attempt, KnowledgePoint } from "@/lib/types";
import {
  ARMS,
  armOutcomes,
  countArms,
  defaultArm,
  pickRepresentation,
  populationPrior,
  posterior,
  sampleBeta,
} from "../preference";

// 固定种子的随机数，测试可复现
function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 16_807) % 2_147_483_647;
    return s / 2_147_483_647;
  };
}

const attempt = (over: Partial<Attempt>): Attempt => ({
  at: "2026-10-23T10:00:00.000Z",
  correct: true,
  d: 1,
  hinted: false,
  id: "a1",
  producedStep: true,
  provisional: false,
  quote: "",
  sessionId: "c1",
  source: "fast",
  turnId: "u2",
  type: "check_correct",
  ...over,
});

const plan = {
  disclosure_level: "partial" as const,
  order: "example_first" as const,
  representation: "analogy" as const,
  target_kc: "kp_a",
};

// 小明一次对话：问 → 导师用类比先例子讲 → 他说“还是不懂” → 导师再讲 → 他答题
const messages = [
  {
    chatId: "c1",
    createdAt: "2026-10-23T09:00:00Z",
    id: "u1",
    plan: null,
    role: "user",
  },
  {
    chatId: "c1",
    createdAt: "2026-10-23T09:01:00Z",
    id: "m1",
    plan,
    role: "assistant",
  },
  {
    chatId: "c1",
    createdAt: "2026-10-23T09:02:00Z",
    id: "u2",
    plan: null,
    role: "user",
  },
  {
    chatId: "c1",
    createdAt: "2026-10-23T09:03:00Z",
    id: "m2",
    plan: {
      ...plan,
      order: "definition_first" as const,
      representation: "code" as const,
    },
    role: "assistant",
  },
  {
    chatId: "c1",
    createdAt: "2026-10-23T09:04:00Z",
    id: "u3",
    plan: null,
    role: "user",
  },
  {
    chatId: "c1",
    createdAt: "2026-10-23T09:05:00Z",
    id: "u4",
    plan: null,
    role: "user",
  },
  {
    chatId: "c1",
    createdAt: "2026-10-23T09:06:00Z",
    id: "u5",
    plan: null,
    role: "user",
  },
];

describe("armOutcomes", () => {
  it("之后两条消息里说了还是不懂，感受记 0；下一道题独立答对，学得记 1", () => {
    const out = armOutcomes(
      messages,
      [{ attempt: attempt({ at: "2026-10-23T09:10:00Z" }), kpId: "kp_a" }],
      [{ messageId: "u2", type: "still_lost" }]
    );
    expect(out).toEqual([
      { arm: "analogy:example_first", feel: false, learn: true },
      { arm: "code:definition_first", feel: true, learn: true },
    ]);
  });

  it("要了提示才答对不算学得好；别的点上的题不算；讲之前的题不算", () => {
    const out = armOutcomes(
      messages.slice(0, 3),
      [
        { attempt: attempt({ at: "2026-10-23T08:00:00Z" }), kpId: "kp_a" },
        { attempt: attempt({ at: "2026-10-23T09:10:00Z" }), kpId: "kp_b" },
        {
          attempt: attempt({ at: "2026-10-23T09:11:00Z", hinted: true }),
          kpId: "kp_a",
        },
      ],
      []
    );
    expect(out).toEqual([
      { arm: "analogy:example_first", feel: true, learn: false },
    ]);
  });

  it("负面反应在两条消息之外就不算；这条回复上的 👎 算", () => {
    expect(
      armOutcomes(
        messages.slice(0, 2).concat(messages.slice(4)),
        [],
        [{ messageId: "u5", type: "give_up" }]
      )[0]
    ).toEqual({ arm: "analogy:example_first", feel: true, learn: undefined });
    expect(
      armOutcomes(
        messages.slice(0, 2),
        [],
        [{ messageId: "m1", type: "thumbs_down" }]
      )[0].feel
    ).toBe(false);
  });

  it("纯出题那轮、没有 order 的旧记录都不算", () => {
    const out = armOutcomes(
      [
        {
          ...messages[1],
          plan: { ...plan, disclosure_level: "question" as const },
        },
        {
          ...messages[3],
          plan: { ...plan, order: undefined as unknown as "example_first" },
        },
      ],
      [],
      []
    );
    expect(out).toEqual([]);
  });
});

describe("countArms / populationPrior / posterior", () => {
  it("计数、先验、后验", () => {
    const counts = countArms([
      { arm: "code:example_first", feel: true, learn: true },
      { arm: "code:example_first", feel: false },
    ]);
    expect(counts["code:example_first"]).toEqual({
      feel: { k: 1, n: 2 },
      learn: { k: 1, n: 1 },
    });
    const prior = populationPrior([counts]);
    expect(prior["code:example_first"]).toEqual({ feel: 0.5, learn: 1 });
    // 没人用过的讲法：用全部讲法合起来的平均
    expect(prior["formula:definition_first"]).toEqual({ feel: 0.5, learn: 1 });
    expect(Object.keys(prior)).toHaveLength(ARMS.length);
    // 谁都没数据：0.5
    expect(populationPrior([])["analogy:example_first"]).toEqual({
      feel: 0.5,
      learn: 0.5,
    });
    // 先验强度 4：均值 0.5 → Beta(2,2)，再加上自己的 1 对 1 错
    expect(
      posterior(counts["code:example_first"], { feel: 0.5, learn: 0.5 })
    ).toEqual({ feel: { a: 3, b: 3 }, learn: { a: 3, b: 2 } });
  });

  it("Beta 抽样的均值对得上", () => {
    const random = seeded();
    const n = 4000;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      sum += sampleBeta({ a: 3, b: 7 }, random);
    }
    expect(sum / n).toBeCloseTo(0.3, 1);
    // 形状参数小于 1 也能抽
    const x = sampleBeta({ a: 0.4, b: 0.6 }, random);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(1);
  });
});

describe("pickRepresentation", () => {
  const point = { kind: "concept" } as KnowledgePoint;

  it("还没有任何讲法记录：照旧规则（说过的偏好 > 知识类型）", () => {
    const fallback = defaultArm(point, []);
    expect(fallback).toEqual({
      order: "example_first",
      representation: "analogy",
    });
    expect(defaultArm(point, ["喜欢先看定义，再看代码"])).toEqual({
      order: "definition_first",
      representation: "code",
    });
    const pick = pickRepresentation({ arms: undefined, fallback });
    expect(pick).toMatchObject({
      ...fallback,
      expectLike: 0.5,
      sampled: false,
    });
  });

  it("学得好是底线：感受最好但学不会的讲法不选", () => {
    const arms = {
      own: {
        "analogy:example_first": {
          feel: { k: 20, n: 20 },
          learn: { k: 1, n: 20 },
        },
        "code:example_first": {
          feel: { k: 10, n: 20 },
          learn: { k: 18, n: 20 },
        },
      },
      prior: {},
    };
    const random = seeded(3);
    const picks = Array.from({ length: 200 }, () =>
      pickRepresentation({ arms, fallback: defaultArm(point, []), random })
    );
    expect(
      picks.some(
        (p) => p.representation === "analogy" && p.order === "example_first"
      )
    ).toBe(false);
    expect(picks.every((p) => p.sampled)).toBe(true);
  });

  it("学得差不多时挑感受好的，但偶尔也试别的", () => {
    const arms = {
      own: Object.fromEntries(
        ARMS.map((arm) => [
          `${arm.representation}:${arm.order}`,
          {
            feel:
              arm.representation === "diagram" && arm.order === "example_first"
                ? { k: 19, n: 20 }
                : { k: 6, n: 20 },
            learn: { k: 14, n: 20 },
          },
        ])
      ),
      prior: {},
    };
    const random = seeded(11);
    const picks = Array.from({ length: 200 }, () =>
      pickRepresentation({ arms, fallback: defaultArm(point, []), random })
    );
    // 学得的抽样有噪声，底线会时不时把它筛掉，所以不是每次都选它；但它最常被选，远多于别的
    const tally = new Map<string, number>();
    for (const p of picks) {
      const key = `${p.representation}:${p.order}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    const diagram = tally.get("diagram:example_first") ?? 0;
    const others = [...tally]
      .filter(([key]) => key !== "diagram:example_first")
      .map(([, n]) => n);
    expect(diagram).toBeGreaterThan(2 * Math.max(...others));
    // 先验 Beta(2,2) 加上 19 次好、1 次不好
    expect(
      picks.find((p) => p.representation === "diagram")?.expectLike
    ).toBeCloseTo(21 / 24, 5);
  });

  it("只有一次记录时，没用过的讲法也有机会被试", () => {
    const arms = {
      own: {
        "analogy:example_first": {
          feel: { k: 1, n: 1 },
          learn: { k: 0, n: 0 },
        },
      },
      prior: {},
    };
    const random = seeded(5);
    const kinds = new Set(
      Array.from({ length: 100 }, () => {
        const p = pickRepresentation({
          arms,
          fallback: defaultArm(point, []),
          random,
        });
        return `${p.representation}:${p.order}`;
      })
    );
    expect(kinds.size).toBeGreaterThan(4);
  });
});
