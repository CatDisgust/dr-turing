import type { KnowledgeKind, RepetitionState } from "@/lib/types";

// 间隔复习调度，纯函数。逐行翻译 DeepTutor learning/scheduler.py 的
// SpacedRepetitionScheduler（指数遗忘 + 按知识类型的冷启动先验，不是拟合过的 FSRS）。
// 翻译部分出自 DeepTutor（github.com/HKUDS/DeepTutor，Apache-2.0），commit a31d826。
// 没翻译的：hydrate（只为兼容 DeepTutor 旧存档）、set_desired_retention、review_reason 文案。
// 时间一律用秒，和 DeepTutor 一致，金标准才能逐位对上。

export const INTERVAL_SEQUENCES: Record<KnowledgeKind, number[]> = {
  concept: [3, 7, 14, 30],
  design: [14, 28],
  memory: [0, 1, 3, 7, 14, 30, 60],
  procedure: [3, 7, 14],
};

export const TYPE_PRIORITY: Record<KnowledgeKind, number> = {
  concept: 3,
  design: 5,
  memory: 2,
  procedure: 4,
};

const TYPE_DIFFICULTY: Record<KnowledgeKind, number> = {
  concept: 0.4,
  design: 0.6,
  memory: 0.3,
  procedure: 0.5,
};

const DEFAULT_DESIRED_RETENTION = 0.9;
const MIN_STABILITY_DAYS = 0.5;
const FAIL_QUALITY = 0.5;
const EPS = 1e-6;
const SAME_SESSION_DAYS = 0.25;
const SECONDS_PER_DAY = 86_400;

// DeepTutor LearningEvidence 里调度用到的字段
export type ReviewEvidence = {
  timestamp: number;
  result: "correct" | "incorrect" | "partial";
  quality?: number | null;
  hintsUsed: number;
  attemptCount: number;
  assessmentType: "quiz" | "qualitative" | "review";
};

function stabilityFromInterval(intervalDays: number, retention: number) {
  const r = Math.min(Math.max(retention, EPS), 1 - EPS);
  if (intervalDays <= 0) {
    return MIN_STABILITY_DAYS;
  }
  return Math.max(MIN_STABILITY_DAYS, intervalDays / -Math.log(r));
}

function intervalFromStability(stability: number, retention: number) {
  const r = Math.min(Math.max(retention, EPS), 1 - EPS);
  return Math.max(EPS, Math.max(stability, EPS) * -Math.log(r));
}

function scheduledIntervalDays(state: RepetitionState, kind: KnowledgeKind) {
  if (state.reviewCount === 0 && INTERVAL_SEQUENCES[kind][0] === 0) {
    return 0;
  }
  let days = intervalFromStability(state.stability, state.desiredRetention);
  if (state.scheduledAfterFailure) {
    days = Math.min(days, Math.max(days * 0.5, MIN_STABILITY_DAYS * 0.2));
  }
  return days;
}

function snapIntervalIndex(intervals: number[], days: number) {
  let nearest = 0;
  for (let i = 1; i < intervals.length; i += 1) {
    if (Math.abs(intervals[i] - days) < Math.abs(intervals[nearest] - days)) {
      nearest = i;
    }
  }
  return Math.max(0, Math.min(nearest, intervals.length - 1));
}

function resolvedQuality(evidence: ReviewEvidence) {
  const given = evidence.quality;
  let quality: number;
  if (given !== undefined && given !== null) {
    quality = given;
  } else if (evidence.result === "correct") {
    quality = 1;
  } else if (evidence.result === "partial") {
    quality = 0.4;
  } else {
    quality = 0;
  }
  if (given === undefined || given === null) {
    quality -= Math.min(0.25, evidence.hintsUsed * 0.08);
    quality -= Math.min(0.2, Math.max(0, evidence.attemptCount - 1) * 0.05);
  }
  return Math.max(0, Math.min(1, quality));
}

export function initialState(
  kind: KnowledgeKind,
  now: number,
  desiredRetention = DEFAULT_DESIRED_RETENTION
): RepetitionState {
  const [first] = INTERVAL_SEQUENCES[kind];
  const stability = stabilityFromInterval(first, DEFAULT_DESIRED_RETENTION);
  const initialInterval =
    first === 0 ? first : intervalFromStability(stability, desiredRetention);
  return {
    consecutiveCorrect: 0,
    consecutiveWrong: 0,
    desiredRetention,
    difficulty: TYPE_DIFFICULTY[kind],
    intervalIndex: 0,
    lapseCount: 0,
    lastReviewAt: null,
    lastScheduledAt: now,
    nextReviewAt: now + initialInterval * SECONDS_PER_DAY,
    retrievability: 1,
    reviewCount: 0,
    scheduledAfterFailure: false,
    stability,
  };
}

export function retrievability(state: RepetitionState, now: number): number {
  const stability = Math.max(state.stability, EPS);
  const anchor = state.lastReviewAt ?? state.nextReviewAt;
  const elapsedDays = Math.max(0, (now - anchor) / SECONDS_PER_DAY);
  return Math.min(1, Math.max(0, Math.exp(-elapsedDays / stability)));
}

// DeepTutor forgetting_risk。hasActiveError 对应它的 error_records（active / retrying）
export function forgettingRisk(
  state: RepetitionState,
  now: number,
  hasActiveError: boolean
): number {
  let risk = 1 - retrievability(state, now);
  if (now > state.nextReviewAt) {
    const overdueDays = (now - state.nextReviewAt) / SECONDS_PER_DAY;
    risk += Math.min(overdueDays / 7, 0.25);
  }
  if (hasActiveError) {
    risk += 0.2;
  }
  if (state.lapseCount) {
    risk += Math.min(0.1 * state.lapseCount, 0.2);
  }
  return Math.min(1, Math.max(0, risk));
}

// DeepTutor schedule_review：一次作答后更新难度、稳定度和下次复习时间。返回新对象，不改入参
export function scheduleReview(
  previous: RepetitionState,
  kind: KnowledgeKind,
  evidence: ReviewEvidence
): RepetitionState {
  const state = { ...previous };
  const moment =
    state.lastReviewAt === null
      ? evidence.timestamp
      : Math.max(evidence.timestamp, state.lastReviewAt);
  const quality = resolvedQuality(evidence);
  const intervals = INTERVAL_SEQUENCES[kind];

  const previousStability = Math.max(state.stability, EPS);
  const previousRetrievability = retrievability(state, moment);
  const elapsedDays =
    state.lastReviewAt === null
      ? 0
      : Math.max(0, moment - state.lastReviewAt) / SECONDS_PER_DAY;
  const sameSessionDays = Math.min(
    SAME_SESSION_DAYS,
    intervalFromStability(previousStability, DEFAULT_DESIRED_RETENTION) * 0.5
  );
  if (state.lastReviewAt !== null && elapsedDays < sameSessionDays) {
    // 同一段时间里反复练：刷新记忆，但不叠乘稳定度、不推迟原来的复习时间
    if (quality >= FAIL_QUALITY) {
      state.reviewCount += 1;
      state.lastReviewAt = moment;
      state.retrievability = 1;
      state.consecutiveWrong = 0;
      return state;
    }
    if (
      state.scheduledAfterFailure &&
      (evidence.result === "partial" ||
        evidence.assessmentType === "qualitative")
    ) {
      state.reviewCount += 1;
      state.lastReviewAt = moment;
      state.retrievability = Math.max(quality, 0.2);
      return state;
    }
  }
  const spacingRatio = Math.min(elapsedDays / previousStability, 4);

  const outcomeError = 1 - quality - state.difficulty;
  const surprise = previousRetrievability - quality;
  state.difficulty = Math.min(
    0.95,
    Math.max(0.05, state.difficulty + 0.12 * outcomeError + 0.08 * surprise)
  );

  if (quality < FAIL_QUALITY) {
    state.consecutiveWrong += 1;
    state.consecutiveCorrect = 0;
    state.lapseCount += 1;
    const retentionFactor = 0.55 - 0.25 * previousRetrievability;
    const difficultyFactor = 1 - 0.25 * state.difficulty;
    state.stability = Math.max(
      MIN_STABILITY_DAYS * 0.1,
      previousStability * retentionFactor * difficultyFactor
    );
    state.retrievability = Math.max(quality, 0.2);
    if (state.consecutiveWrong >= 2) {
      state.consecutiveWrong = 0;
    }
  } else {
    state.consecutiveWrong = 0;
    state.consecutiveCorrect += 1;
    const retrievalEffort = 1 + (1 - previousRetrievability) * 1.5;
    const spacingBonus = 1 + spacingRatio * 0.15;
    const learnability = 1.35 - 0.6 * state.difficulty;
    const qualityStrength = Math.max(
      0,
      (quality - FAIL_QUALITY) / (1 - FAIL_QUALITY)
    );
    let growth =
      1 + qualityStrength * learnability * retrievalEffort * spacingBonus;
    if (quality >= 0.8 && state.consecutiveCorrect >= 2) {
      growth *= 1.15;
    }
    state.stability = Math.max(MIN_STABILITY_DAYS, previousStability * growth);
    state.retrievability = 1;
    if (state.consecutiveCorrect >= 2) {
      state.consecutiveCorrect = 0;
    }
  }

  state.reviewCount += 1;
  state.lastReviewAt = moment;
  state.lastScheduledAt = moment;
  state.scheduledAfterFailure = quality < FAIL_QUALITY;
  const intervalDays = scheduledIntervalDays(state, kind);
  state.nextReviewAt = moment + intervalDays * SECONDS_PER_DAY;
  state.intervalIndex = snapIntervalIndex(intervals, intervalDays);
  return state;
}

// DeepTutor replay：从第一条证据的时间建初始状态，再逐条调度
export function replaySchedule(
  kind: KnowledgeKind,
  evidence: ReviewEvidence[],
  now: number
): RepetitionState {
  if (evidence.length === 0) {
    return initialState(kind, now);
  }
  let state = initialState(kind, evidence[0].timestamp);
  for (const event of evidence) {
    state = scheduleReview(state, kind, event);
  }
  return state;
}
