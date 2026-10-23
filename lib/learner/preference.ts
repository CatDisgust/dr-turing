import type {
  ArmCounts,
  Attempt,
  KnowledgePoint,
  LearnerState,
  StudentEventType,
  TutorPlan,
} from "@/lib/types";
import { B_TYPES, W_TYPES } from "./events";

// 偏好的讲法（学生建模方案 C）：讲法 = 表征 × 先例子/先定义，共 8 种，每种算一个“臂”。
// 每个臂两个 Beta 分布：学得好（讲完后同一点下一道批改题独立答对）、感受好（之后 2 轮内没有负面反应）。
// 选法：带底线的 Thompson 采样——学得好是底线，感受好在底线内挑

type Representation = TutorPlan["representation"];
type Order = TutorPlan["order"];

const REPRESENTATIONS: readonly Representation[] = [
  "analogy",
  "code",
  "formula",
  "diagram",
];
const ORDERS: readonly Order[] = ["example_first", "definition_first"];

export const ARMS = REPRESENTATIONS.flatMap((representation) =>
  ORDERS.map((order) => ({ order, representation }))
);

export const armKey = (arm: { representation: Representation; order: Order }) =>
  `${arm.representation}:${arm.order}`;

// 学得好的抽样值比最好的低不超过这么多，才有资格比感受（方案 C 的底线）
export const LEARN_FLOOR = 0.1;
// 全体平均作先验，强度相当于 4 次（方案 C 冷启动）
export const PRIOR_STRENGTH = 4;
// 全体学生也没数据时的先验均值
const NEUTRAL = 0.5;
// 讲完之后看几轮的反应
const FEEL_TURNS = 2;

const NEGATIVE: readonly StudentEventType[] = [...W_TYPES, ...B_TYPES];

const emptyCounts = (): ArmCounts => ({
  feel: { k: 0, n: 0 },
  learn: { k: 0, n: 0 },
});

// ---- 从原始记录数出每个臂的效果 ----

type MessageRow = {
  id: string;
  chatId: string;
  role: string;
  createdAt: Date | string;
  plan: Pick<
    TutorPlan,
    | "representation"
    | "order"
    | "target_kc"
    | "disclosure_level"
    | "expect_like"
  > | null;
};

export type ArmOutcome = {
  arm: string;
  learn?: boolean;
  feel: boolean;
  // 教学笔记（方案 E）检验要用：哪条回复、哪个点、什么时候、当时预计喜不喜欢
  messageId: string;
  chatId: string;
  kpId: string;
  at: string;
  expectLike?: number;
};

const time = (t: Date | string) => new Date(t).getTime();

// 只有导师真的讲了东西的那轮才算用过一次这个讲法：纯提问那轮不算（2026-10-23 告知用户）
const explained = (plan: NonNullable<MessageRow["plan"]>) =>
  plan.disclosure_level !== "question" && plan.order !== undefined;

export function armOutcomes(
  messages: readonly MessageRow[],
  rows: readonly { attempt: Attempt; kpId: string }[],
  events: readonly { type: StudentEventType; messageId: string }[]
): ArmOutcome[] {
  const byChat = new Map<string, MessageRow[]>();
  for (const m of messages) {
    byChat.set(m.chatId, [...(byChat.get(m.chatId) ?? []), m]);
  }
  const graded = rows.filter((r) => r.attempt.correct !== undefined);
  const outcomes: ArmOutcome[] = [];
  for (const chat of byChat.values()) {
    const sorted = chat.toSorted(
      (a, b) => time(a.createdAt) - time(b.createdAt)
    );
    sorted.forEach((m, i) => {
      if (m.role !== "assistant" || !m.plan || !explained(m.plan)) {
        return;
      }
      const { plan } = m;
      // 感受：这条回复上的 👎，或之后学生两条消息里的负面反应
      const window = new Set([
        m.id,
        ...sorted
          .slice(i + 1)
          .filter((n) => n.role === "user")
          .slice(0, FEEL_TURNS)
          .map((n) => n.id),
      ]);
      const feel = !events.some(
        (e) => window.has(e.messageId) && NEGATIVE.includes(e.type)
      );
      // 学得好：讲完之后同一个点上的下一道批改题，没要提示就答对
      const next = graded.find(
        (r) =>
          r.kpId === plan.target_kc && time(r.attempt.at) > time(m.createdAt)
      );
      outcomes.push({
        arm: armKey({
          order: plan.order,
          representation: plan.representation,
        }),
        at: new Date(m.createdAt).toISOString(),
        chatId: m.chatId,
        expectLike: plan.expect_like,
        feel,
        kpId: plan.target_kc,
        learn: next
          ? next.attempt.correct === true && !next.attempt.hinted
          : undefined,
        messageId: m.id,
      });
    });
  }
  return outcomes;
}

export function countArms(
  outcomes: readonly ArmOutcome[]
): Record<string, ArmCounts> {
  const counts: Record<string, ArmCounts> = {};
  for (const o of outcomes) {
    const c = counts[o.arm] ?? emptyCounts();
    c.feel = { k: c.feel.k + Number(o.feel), n: c.feel.n + 1 };
    if (o.learn !== undefined) {
      c.learn = { k: c.learn.k + Number(o.learn), n: c.learn.n + 1 };
    }
    counts[o.arm] = c;
  }
  return counts;
}

// ---- 冷启动先验：全体学生每种讲法的平均效果 ----

const rate = (parts: { n: number; k: number }[]) => {
  const n = parts.reduce((s, p) => s + p.n, 0);
  return n === 0 ? null : parts.reduce((s, p) => s + p.k, 0) / n;
};

export function populationPrior(
  students: readonly Record<string, ArmCounts>[]
): Record<string, { learn: number; feel: number }> {
  const all = students.flatMap((s) => Object.values(s));
  // 某种讲法谁都没用过：用所有讲法合起来的平均；也没有就 0.5
  const overall = {
    feel: rate(all.map((c) => c.feel)) ?? NEUTRAL,
    learn: rate(all.map((c) => c.learn)) ?? NEUTRAL,
  };
  return Object.fromEntries(
    ARMS.map((arm) => {
      const key = armKey(arm);
      const mine = students.flatMap((s) => (s[key] ? [s[key]] : []));
      return [
        key,
        {
          feel: rate(mine.map((c) => c.feel)) ?? overall.feel,
          learn: rate(mine.map((c) => c.learn)) ?? overall.learn,
        },
      ];
    })
  );
}

// ---- 后验和抽样 ----

type Beta = { a: number; b: number };

export function posterior(
  own: ArmCounts | undefined,
  prior: { learn: number; feel: number } | undefined
): { learn: Beta; feel: Beta } {
  const c = own ?? emptyCounts();
  const beta = (mu: number, { n, k }: { n: number; k: number }) => ({
    a: PRIOR_STRENGTH * mu + k,
    b: PRIOR_STRENGTH * (1 - mu) + (n - k),
  });
  return {
    feel: beta(prior?.feel ?? NEUTRAL, c.feel),
    learn: beta(prior?.learn ?? NEUTRAL, c.learn),
  };
}

const mean = ({ a, b }: Beta) => a / (a + b);

// 标准正态（Box–Muller）
function normal(random: () => number): number {
  const u = 1 - random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

// Gamma(shape, 1)（Marsaglia–Tsang）；shape < 1 时先抽 shape+1 再缩放
function gamma(shape: number, random: () => number): number {
  if (shape < 1) {
    return gamma(shape + 1, random) * random() ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal(random);
    const v = (1 + c * x) ** 3;
    if (
      v > 0 &&
      Math.log(1 - random()) < 0.5 * x * x + d - d * v + d * Math.log(v)
    ) {
      return d * v;
    }
  }
}

export function sampleBeta({ a, b }: Beta, random: () => number): number {
  const x = gamma(a, random);
  return x / (x + gamma(b, random));
}

// ---- 默认讲法：他还没有任何讲法记录时用（用户 2026-10-23 选“先照旧规则，之后再换着试”） ----

// 学生说过的偏好优先；没说过就按知识类型
export function defaultArm(
  point: KnowledgePoint,
  preferences: string[]
): { representation: Representation; order: Order } {
  const said = preferences.join(" ");
  const order: Order = /先.{0,2}定义|定义.{0,2}先/.test(said)
    ? "definition_first"
    : "example_first";
  if (/代码|code/i.test(said)) {
    return { order, representation: "code" };
  }
  if (/公式|数学/.test(said)) {
    return { order, representation: "formula" };
  }
  if (/图|画/.test(said)) {
    return { order, representation: "diagram" };
  }
  if (/类比|比喻|例子/.test(said)) {
    return { order, representation: "analogy" };
  }
  if (point.kind === "procedure") {
    return { order, representation: "code" };
  }
  return {
    order,
    representation: point.kind === "design" ? "diagram" : "analogy",
  };
}

export function pickRepresentation(input: {
  arms: LearnerState["arms"];
  fallback: { representation: Representation; order: Order };
  random?: () => number;
}): {
  representation: Representation;
  order: Order;
  expectLike: number;
  sampled: boolean;
} {
  const own = input.arms?.own ?? {};
  const prior = input.arms?.prior ?? {};
  const post = (key: string) => posterior(own[key], prior[key]);
  const used = Object.values(own).some((c) => c.feel.n > 0);
  if (!used) {
    return {
      ...input.fallback,
      expectLike: mean(post(armKey(input.fallback)).feel),
      sampled: false,
    };
  }
  const random = input.random ?? Math.random;
  const draws = ARMS.map((arm) => {
    const p = post(armKey(arm));
    return {
      arm,
      feel: sampleBeta(p.feel, random),
      feelMean: mean(p.feel),
      learn: sampleBeta(p.learn, random),
    };
  });
  // 底线：学得好不比最好的差太多；在这些里挑感受最好的
  const best = Math.max(...draws.map((d) => d.learn));
  const chosen = draws
    .filter((d) => d.learn >= best - LEARN_FLOOR)
    .reduce((x, y) => (y.feel > x.feel ? y : x));
  return { ...chosen.arm, expectLike: chosen.feelMean, sampled: true };
}
