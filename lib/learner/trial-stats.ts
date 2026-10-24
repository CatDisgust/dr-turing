import type { LearnerState } from "@/lib/types";
import { FULL_O, HALF_M } from "./config";
import { isGraded } from "./mastery";
import { reviewDue } from "./question";

// 管理页看试用效果（2026-10-24 评审建议）：每个账号答了几道题、对了几道、
// 点亮了多少（真会 = 全亮、看懂 = 半亮）、现在有几个该复习、
// 隔天复习做了几道、几道是自己独立做对的（和底层能力“保持”同一口径）
export type LearnStats = {
  answered: number;
  correct: number;
  full: number;
  half: number;
  due: number;
  reviewed: number;
  reviewPassed: number;
};

export function learnStats(
  states: readonly LearnerState[],
  now: string
): LearnStats {
  const stats: LearnStats = {
    answered: 0,
    correct: 0,
    due: 0,
    full: 0,
    half: 0,
    reviewed: 0,
    reviewPassed: 0,
  };
  for (const state of states) {
    for (const node of Object.values(state.nodes)) {
      const graded = node.attempts.filter(isGraded);
      stats.answered += graded.length;
      stats.correct += graded.filter((a) => a.correct).length;
      const reviews = graded.filter(
        (a) => a.questionKind === "review" || a.type === "review_correct"
      );
      stats.reviewed += reviews.length;
      stats.reviewPassed += reviews.filter(
        (a) => a.correct === true && !a.hinted
      ).length;
      if (node.O >= FULL_O) {
        stats.full += 1;
      } else if (node.M >= HALF_M) {
        stats.half += 1;
      }
      if (reviewDue(node, now)) {
        stats.due += 1;
      }
    }
  }
  return stats;
}
