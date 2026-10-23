import type { Attempt } from "@/lib/types";
import {
  BKT,
  CONFIDENCE_CAP,
  RECENCY_WEIGHTS,
  REVEALED_LEARN_FACTOR,
  REVIEW_PULL,
} from "./config";

// 翻译部分出自 DeepTutor（github.com/HKUDS/DeepTutor，Apache-2.0）deeptutor/learning/mastery.py，commit a31d826。
// 掌握度，全是纯函数。
// M 用标准 BKT 更新；O 按构建深度 d 跟着 M 的涨幅涨，且永远不超过 M。
// computeMastery 是 DeepTutor mastery.compute_mastery 的逐行翻译，留作备选。

// DeepTutor：近几次作答的加权正确率，越新权重越大；证据太少时封顶
export function computeMastery(correctness: (boolean | number)[]): number {
  if (correctness.length === 0) {
    return 0;
  }
  const recent = correctness.slice(-RECENCY_WEIGHTS.length);
  const weights = RECENCY_WEIGHTS.slice(-recent.length);
  let weighted = 0;
  let total = 0;
  recent.forEach((c, i) => {
    weighted += weights[i] * Math.max(0, Math.min(1, Number(c)));
  });
  for (const w of weights) {
    total += w;
  }
  return Math.min(weighted / total, CONFIDENCE_CAP[recent.length] ?? 1);
}

// BKT 一步：先按对错求后验，再加上这次练习学会的概率
export function bktUpdate(
  M: number,
  correct: boolean,
  { guess, slip, learn }: { guess: number; slip: number; learn: number } = BKT
): number {
  const posterior = correct
    ? (M * (1 - slip)) / (M * (1 - slip) + (1 - M) * guess)
    : (M * slip) / (M * slip + (1 - M) * (1 - guess));
  return posterior + (1 - posterior) * learn;
}

// O_new = min(M_new, O + d × max(M_new − 以前最高的 M, 0))：只有 M 创新高 O 才跟着涨，涨多少看自己做了多少。
// 跟“以前最高”比而不是跟“上一次”比：M 跌了再涨回原来的高度不算新涨幅，否则对错交替会重复计入，
// 不复习也能全亮（建模审查第 4 条，用户 2026-10-23 定）
export function updateO(
  O: number,
  peakBefore: number,
  mAfter: number,
  d: Attempt["d"]
): number {
  return Math.min(mAfter, O + d * Math.max(mAfter - peakBefore, 0));
}

// 批改过的证据才动掌握度；“说懂了”“求助”只记不算
export function isGraded(attempt: Attempt): boolean {
  return attempt.correct !== undefined;
}

// 一条批改过的证据怎么动 M、O（主文档“学生怎么建模”的更新表）：
// - 答案被揭示后照着做对（d = 0）：弱证据，学习率减半，O 不动
// - 隔天复习独立做对：O 向 M 靠拢
//   只靠 d 吃涨幅时 O 的上限是 1 − 先验 = 0.7，到不了全亮门槛，所以全亮只能靠隔天复习（用户 2026-10-22 定）
// - 其余：M 按 BKT，O 按 d 吃到 M 的涨幅；答错时 M 降、O 不变
export function applyGraded(
  { M, O, peak = M }: { M: number; O: number; peak?: number },
  attempt: Attempt,
  learn: number = BKT.learn
): { M: number; O: number; peak: number } {
  const correct = attempt.correct === true;
  const revealed = correct && attempt.d === 0;
  const next = bktUpdate(M, correct, {
    ...BKT,
    learn: revealed ? learn * REVEALED_LEARN_FACTOR : learn,
  });
  let nextO = updateO(O, Math.max(peak, M), next, attempt.d);
  if (attempt.type === "review_correct" && correct && !attempt.hinted) {
    nextO = Math.min(next, Math.max(nextO, O + REVIEW_PULL * (next - O)));
  }
  return { M: next, O: nextO, peak: Math.max(peak, M, next) };
}

// 从头重放全部证据得到 M、O。状态里存的 M、O 只是缓存，以这里为准。learn 是学习率 ℓ，默认全局值
export function masteryFromAttempts(
  attempts: Attempt[],
  prior: number = BKT.prior,
  learn: number = BKT.learn
): { M: number; O: number } {
  let mastery = { M: prior, O: 0, peak: prior };
  for (const attempt of attempts) {
    if (isGraded(attempt)) {
      mastery = applyGraded(mastery, attempt, learn);
    }
  }
  return { M: mastery.M, O: mastery.O };
}
