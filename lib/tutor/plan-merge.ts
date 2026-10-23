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
    // 规则算出的已会先修一定留着（录视频时“从你会的…讲起”不能时有时无），Claude 只能往上加
    start_from: [
      ...new Set([
        ...rulePlan.start_from,
        ...filled.start_from.filter((id) => limits.prereqIds.includes(id)),
      ]),
    ],
  };
}

// 回复标签上要写“从你会的「X」讲起”：把起点的名字一起存进 plan，旧消息重新打开也能显示
export function nameStartFrom(
  plan: TutorPlan,
  points: { id: string; name: string }[]
): TutorPlan {
  return {
    ...plan,
    start_from_names: plan.start_from.map(
      (id) => points.find((p) => p.id === id)?.name ?? id
    ),
  };
}
