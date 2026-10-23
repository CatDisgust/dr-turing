import { describe, expect, it } from "vitest";
import type { Attempt } from "@/lib/types";
import { BKT } from "../config";
import { masteryFromAttempts } from "../mastery";
import {
  calibrate,
  pCorrect,
  predict,
  replayScores,
  reviewedAttempts,
} from "../predict";
import { rebuildStudentModel } from "../student-model";

// 学生建模方案 D：出题前先猜，答完核对；对照组是全局参数从头重放

let seq = 0;
const answer = (
  correct: boolean,
  fields: Partial<Attempt> = {}
): { attempt: Attempt; kpId: string } => {
  seq += 1;
  return {
    attempt: {
      at: "2026-10-23T00:00:00Z",
      correct,
      d: 1,
      hinted: false,
      id: `a${seq}`,
      producedStep: true,
      provisional: false,
      quote: "",
      sessionId: "s",
      source: "fast",
      turnId: `t${seq}`,
      type: correct ? "check_correct" : "check_wrong",
      ...fields,
    },
    kpId: "kp",
  };
};

// 模型猜 M 时的预测；对照组按空证据（先验 0.3）
const at = (M: number) => predict([], M);

// 按全局参数一步步出题、作答，预测记成当时的 M
function session(results: boolean[]) {
  const rows: { attempt: Attempt; kpId: string }[] = [];
  for (const correct of results) {
    const before = rows.map((r) => r.attempt);
    const { M } = masteryFromAttempts(before);
    rows.push(answer(correct, { prediction: predict(before, M) }));
  }
  return rows;
}

describe("预测", () => {
  it("p = M(1−s) + (1−M)g：先验 0.3 时 0.41", () => {
    expect(pCorrect(BKT.prior)).toBeCloseTo(0.41);
    expect(at(0.9)).toEqual({
      baseline: pCorrect(BKT.prior),
      expectLike: null,
      learnRate: BKT.learn,
      M: 0.9,
      pCorrect: 0.9 * 0.9 + 0.1 * 0.2,
    });
  });
});

describe("核对", () => {
  it("没有能核对的题：null", () => {
    expect(calibrate([])).toBeNull();
    // D 之前的题没有预测
    expect(calibrate([answer(true)])).toBeNull();
  });

  it("要过提示的题不算：预测是出题时对“独立答”猜的", () => {
    const rows = session([true]);
    rows.push(answer(true, { hinted: true, prediction: at(0.5) }));
    expect(calibrate(rows)?.n).toBe(1);
  });

  it("用全局参数做的预测，和对照组完全一样", () => {
    const c = calibrate(session([false, true, true, false, true]));
    expect(c?.n).toBe(5);
    expect(c?.logLoss).toBeCloseTo(c?.baseline.logLoss ?? -1);
    expect(c?.brier).toBeCloseTo(c?.baseline.brier ?? -1);
  });

  it("算 log loss、Brier、猜对方向的题数", () => {
    const rows = [
      answer(true, { prediction: at(0.9) }),
      answer(false, { prediction: at(0.1) }),
    ];
    const c = calibrate(rows);
    const p1 = pCorrect(0.9);
    const p2 = pCorrect(0.1);
    expect(c?.hits).toBe(2);
    expect(c?.brier).toBeCloseTo(((1 - p1) ** 2 + p2 ** 2) / 2);
    expect(c?.logLoss).toBeCloseTo(-(Math.log(p1) + Math.log(1 - p2)) / 2);
  });

  it("模型猜得更准时，分数比对照组低", () => {
    // 他其实全会：模型猜 0.95，对照组按先验 0.3 猜
    const rows = [true, true, true].map((y) =>
      answer(y, { prediction: at(0.95) })
    );
    const c = calibrate(rows);
    expect(c?.logLoss).toBeLessThan(c?.baseline.logLoss ?? 0);
  });
});

describe("离线重放", () => {
  it("学得快的学生：学习率大的那组猜得更准", () => {
    const rows = [false, true, true, true, true].map((y) => answer(y));
    const { n, byLearn } = replayScores(rows, [0.15, 0.4]);
    expect(n).toBe(5);
    expect(byLearn[1].logLoss).toBeLessThan(byLearn[0].logLoss);
  });

  it("要过提示的不算进重放的题数，但还是算证据", () => {
    const rows = [answer(true, { d: 0.5, hinted: true }), answer(true)];
    expect(replayScores(rows, [0.15]).n).toBe(1);
  });
});

describe("复核后的记录", () => {
  it("撤销的去掉、改判的翻过来，改判两次等于没改", () => {
    const [a, b, c] = [answer(true), answer(false), answer(true)];
    const rows = reviewedAttempts(
      [a, b, c],
      [
        { payload: { attemptId: a.attempt.id }, type: "review_retract" },
        { payload: { attemptId: b.attempt.id }, type: "review_flip" },
        { payload: { attemptId: c.attempt.id }, type: "review_flip" },
        { payload: { attemptId: c.attempt.id }, type: "review_flip" },
        { payload: {}, type: "give_up" },
      ]
    );
    expect(rows.map((r) => [r.attempt.id, r.attempt.correct])).toEqual([
      [b.attempt.id, true],
      [c.attempt.id, true],
    ]);
  });

  it("学生模型按复核后的记录算核对", () => {
    const rows = session([true, false]);
    const model = rebuildStudentModel(rows, [
      { payload: { attemptId: rows[1].attempt.id }, type: "review_retract" },
    ]);
    expect(model.calibration?.n).toBe(1);
    expect(model.answers.total).toBe(1);
  });
});
