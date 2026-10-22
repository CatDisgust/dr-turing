"use client";

import type { TutorPlan } from "@/lib/types";

// 助手消息下面的一行小字：这一轮规划器定的动作，展开看全部字段

const ACTION = {
  diagnose_misconception: "反例诊断",
  hint: "最小提示",
  independent_check: "独立题",
  review: "复习",
  teach: "讲解",
  variant: "变式题",
} as const;

const DISCLOSURE = {
  full: "讲全",
  hint: "只给提示",
  partial: "只补缺口",
  question: "只提问",
} as const;

export function PlanBadge({ plan }: { plan: TutorPlan }) {
  return (
    <details className="text-muted-foreground text-xs" data-testid="plan">
      <summary className="cursor-pointer select-none">
        规划：{ACTION[plan.next_action]} · {DISCLOSURE[plan.disclosure_level]}
        {plan.elicits_production ? " · 要学生产出" : ""}
      </summary>
      <p className="mt-1">
        {plan.rationale}
        {plan.filled_by === "rules" ? "（Claude 没填上，这是规则默认值）" : ""}
      </p>
      <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">
        {JSON.stringify(plan, null, 2)}
      </pre>
    </details>
  );
}
