import type { Attempt } from "@/lib/types";
import { BKT } from "./config";
import { applyGraded, isGraded } from "./mastery";
import { pCorrect } from "./predict";

// 学得快慢：个人化 BKT（Yudelson 等，2013），给每个学生单独拟合学习率 ℓ（学生建模方案 B）。
// 数据少，用最大后验网格搜索：ℓ 从 0.05 到 0.40 每隔 0.025 试一个，按时间顺序重放他的全部作答算似然，
// 再加上以 0.15 为中心、强度相当于 10 题的 Beta 先验。猜对 g、失误 s 仍用全局值

export const LEARN_GRID = Array.from(
  { length: 15 },
  (_, i) => Math.round((0.05 + 0.025 * i) * 1000) / 1000
);

// Beta(α, β)：众数在 0.15，相当于先看过 10 题（α − 1 + β − 1 = 10）。
// 中心取众数不取均值：一题都没答时，最大后验正好落在全局值 0.15
const PRIOR_STRENGTH = 10;
const ALPHA = 1 + BKT.learn * PRIOR_STRENGTH;
const BETA = 1 + (1 - BKT.learn) * PRIOR_STRENGTH;

const logPrior = (l: number) =>
  (ALPHA - 1) * Math.log(l) + (BETA - 1) * Math.log(1 - l);

// 按 ℓ 重放：每个点从先验起步，没要提示就作答的题算一次似然，所有批改过的证据都更新 M
export function logLikelihood(
  rows: readonly { attempt: Attempt; kpId: string }[],
  learn: number
): number {
  const mastery = new Map<string, { M: number; O: number; peak: number }>();
  let sum = 0;
  for (const { attempt, kpId } of rows) {
    if (!isGraded(attempt)) {
      continue;
    }
    const before = mastery.get(kpId) ?? {
      M: BKT.prior,
      O: 0,
      peak: BKT.prior,
    };
    if (!attempt.hinted) {
      const p = pCorrect(before.M);
      sum += Math.log(attempt.correct ? p : 1 - p);
    }
    mastery.set(kpId, applyGraded(before, attempt, learn));
  }
  return sum;
}

export function fitLearnRate(
  rows: readonly { attempt: Attempt; kpId: string }[]
): number {
  let best: number = BKT.learn;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const l of LEARN_GRID) {
    const score = logLikelihood(rows, l) + logPrior(l);
    if (score > bestScore) {
      best = l;
      bestScore = score;
    }
  }
  return best;
}
