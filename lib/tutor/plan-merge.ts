import type { TutorPlan } from "@/lib/types";

// 把 Claude 填的字段并进规则给的 plan。动作、目标、提示词、命中的规则、讲法只认代码；
// Claude 的结果再过一遍硬约束，免得它越界

export function mergePlan(
  rulePlan: TutorPlan,
  filled: {
    start_from: string[];
    disclosure_level: TutorPlan["disclosure_level"];
    action_type: TutorPlan["action_type"];
    check_misconception_first: boolean;
    rationale: string;
  },
  limits: {
    prereqIds: string[];
    justTellMe: boolean;
    misconception?: string; // 这个点上第一条没纠正的误解原文
  }
): TutorPlan {
  const disclosure_level = limits.justTellMe ? "full" : filled.disclosure_level;
  return {
    ...rulePlan,
    action_type: filled.action_type,
    check_misconception_first: filled.check_misconception_first
      ? limits.misconception
      : undefined,
    disclosure_level,
    elicits_production: disclosure_level !== "full",
    filled_by: "claude",
    rationale: filled.rationale.trim() || rulePlan.rationale,
    start_from: [
      ...new Set(
        filled.start_from.filter((id) => limits.prereqIds.includes(id))
      ),
    ],
  };
}
