import type { KnowledgeKind } from "@/lib/types";

// 引擎的全部门槛和参数都在这一处。标“假设”的是没有实测、先拍的值。

// BKT（Corbett & Anderson 1995）：猜对 g、失误 s、每次练习学会 ℓ（假设）
export const BKT = {
  guess: 0.2,
  learn: 0.15,
  // 还没有任何证据时的 M（假设）
  prior: 0.3,
  slip: 0.1,
} as const;

// 节点亮度（主文档）：M ≥ 0.6 半亮，O ≥ 0.7 全亮
export const HALF_M = 0.6;
export const FULL_O = 0.7;

// DeepTutor policy.QUANTITATIVE_GATE：记忆和步骤类按正确率过门槛
export const QUANTITATIVE_GATE: Partial<Record<KnowledgeKind, number>> = {
  memory: 0.9,
  procedure: 0.9,
};

// DeepTutor policy.QUALITATIVE_TYPES：原理和设计类靠讲清楚过门槛，没有标准答案可比
export const QUALITATIVE_KINDS: readonly KnowledgeKind[] = [
  "concept",
  "design",
];

// DeepTutor mastery.compute_mastery 的近因权重（旧 → 新）和低证据封顶
export const RECENCY_WEIGHTS = [0.5, 0.7, 0.85, 0.95, 1.0] as const;
export const CONFIDENCE_CAP: Record<number, number> = { 1: 0.5, 2: 0.8 };

// 投入度 W：放弃、“直接告诉我”、跳题加起来到这个数就算偏低（假设）
export const ENGAGEMENT_LOW = 3;

// 主文档更新表：答案被揭示后照着做对是弱证据，学习率减半
export const REVEALED_LEARN_FACTOR = 0.5;

// 主文档更新表：隔天复习独立做对，O 向 M 靠拢这么多（假设）。这是 O 达到全亮门槛的唯一途径
export const REVIEW_PULL = 0.5;
