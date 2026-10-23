import type {
  Attempt,
  Calibration,
  Prediction,
  StudentEventType,
} from "@/lib/types";
import { BKT } from "./config";
import { masteryFromAttempts } from "./mastery";

// 预测和核对（学生建模方案 D）：出题前先猜他能不能独立答对，答完对答案。
// 越来越准、而且比所有人共用一套参数更准，就说明越来越懂他

// 会的人偶尔失误、不会的人也能蒙对：p = M(1−s) + (1−M)g
export function pCorrect(M: number): number {
  return M * (1 - BKT.slip) + (1 - M) * BKT.guess;
}

// 出题前对这个点的预测。attempts 是这个点到目前为止的证据，M 是按学生自己的 ℓ 算出来的当前掌握度
export function predict(
  attempts: Attempt[],
  M: number,
  learnRate: number = BKT.learn
): Prediction {
  return {
    baseline: pCorrect(masteryFromAttempts(attempts).M),
    expectLike: null,
    learnRate,
    M,
    pCorrect: pCorrect(M),
  };
}

// p 夹在 (0, 1) 里，log 不会爆
const clamp = (p: number) => Math.min(Math.max(p, 1e-6), 1 - 1e-6);

function scores(pairs: { p: number; y: boolean }[]) {
  const n = pairs.length;
  return {
    brier: pairs.reduce((sum, { p, y }) => sum + (p - Number(y)) ** 2, 0) / n,
    logLoss:
      -pairs.reduce(
        (sum, { p, y }) =>
          sum + (y ? Math.log(clamp(p)) : Math.log(1 - clamp(p))),
        0
      ) / n,
  };
}

type Row = { attempt: Attempt; kpId: string };

// 复核撤销的去掉，改判的把对错翻过来：得到复核后的作答记录（按时间顺序）
export function reviewedAttempts(
  transactions: readonly Row[],
  events: readonly {
    type: StudentEventType;
    payload: { attemptId?: string };
  }[]
): Row[] {
  const retracted = new Set(
    events
      .filter((e) => e.type === "review_retract")
      .map((e) => e.payload.attemptId)
  );
  const flips = new Map<string, number>();
  for (const e of events) {
    if (e.type === "review_flip" && e.payload.attemptId) {
      flips.set(e.payload.attemptId, (flips.get(e.payload.attemptId) ?? 0) + 1);
    }
  }
  return transactions
    .filter((t) => !retracted.has(t.attempt.id))
    .map((t) =>
      (flips.get(t.attempt.id) ?? 0) % 2 === 1
        ? { ...t, attempt: { ...t.attempt, correct: !t.attempt.correct } }
        : t
    );
}

// 能核对的题：出题时有预测、没要提示也没看答案就答了
const scorable = (a: Attempt) =>
  a.prediction !== undefined && !a.hinted && a.correct !== undefined;

// 核对：模型出题时的预测 vs 实际结果，对照组是同一批题上全局 ℓ 的预测
export function calibrate(rows: readonly Row[]): Calibration | null {
  const items = rows
    .map((r) => r.attempt)
    .filter(scorable)
    .map((a) => {
      const p = a.prediction?.pCorrect ?? 0;
      // 早期没记对照的预测：那时只有全局参数，对照就是它自己
      return { base: a.prediction?.baseline ?? p, p, y: a.correct === true };
    });
  if (items.length === 0) {
    return null;
  }
  return {
    ...scores(items),
    baseline: scores(items.map(({ base, y }) => ({ p: base, y }))),
    hits: items.filter(({ p, y }) => p >= 0.5 === y).length,
    n: items.length,
  };
}

// 离线重放（scripts/replay-eval.ts）：只用作答记录，按两个学习率从头重放，在同一批题上比谁猜得准
export function replayScores(
  rows: readonly Row[],
  learnRates: readonly number[]
): { n: number; byLearn: { learn: number; logLoss: number; brier: number }[] } {
  const byKp = new Map<string, Attempt[]>();
  const pairs: { ps: number[]; y: boolean }[] = [];
  for (const { attempt, kpId } of rows) {
    const before = byKp.get(kpId) ?? [];
    if (attempt.correct !== undefined && !attempt.hinted) {
      pairs.push({
        ps: learnRates.map((l) =>
          pCorrect(masteryFromAttempts(before, BKT.prior, l).M)
        ),
        y: attempt.correct === true,
      });
    }
    byKp.set(kpId, [...before, attempt]);
  }
  return {
    byLearn:
      pairs.length === 0
        ? []
        : learnRates.map((learn, i) => ({
            learn,
            ...scores(pairs.map(({ ps, y }) => ({ p: ps[i], y }))),
          })),
    n: pairs.length,
  };
}
