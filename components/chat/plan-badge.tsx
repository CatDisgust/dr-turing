"use client";

import type { TurnTiming, TutorPlan } from "@/lib/types";

// 回答上方的一行小字（视觉规范 TutorReply 的来源行）：这一轮规划器定的动作，展开看理由、耗时和全部字段

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

// D12 验收要首字 ≤ 3 秒：把这一轮各段耗时摆出来，超了标红
const FIRST_TOKEN_LIMIT_MS = 3000;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function timingText(timing: TurnTiming) {
  return `首字 ${seconds(timing.firstTokenMs)}（引擎 ${seconds(timing.engineMs)} · 规划 ${seconds(timing.planMs)} · 快路径 ${timing.fastModel}）`;
}

export function TimingLine({ timing }: { timing: TurnTiming }) {
  return (
    <span
      className={
        timing.firstTokenMs > FIRST_TOKEN_LIMIT_MS
          ? "text-[13px] text-[var(--duo-red-ink)]"
          : "text-[13px] text-muted-foreground"
      }
      data-testid="timing"
    >
      {timingText(timing)}
    </span>
  );
}

export function PlanBadge({
  plan,
  timing,
}: {
  plan: TutorPlan;
  timing?: TurnTiming;
}) {
  return (
    <details
      className="text-[13px] text-muted-foreground leading-normal"
      data-testid="plan"
    >
      <summary className="cursor-pointer list-none select-none">
        Dr.Turing · {ACTION[plan.next_action]} ·{" "}
        {DISCLOSURE[plan.disclosure_level]}
        {plan.elicits_production ? " · 要你说出来" : ""}
      </summary>
      {timing ? <TimingLine timing={timing} /> : null}
      <p className="mt-1">
        {plan.rationale}
        {plan.filled_by === "rules" ? "（Claude 没填上，这是规则默认值）" : ""}
      </p>
      <pre className="mt-1 overflow-x-auto rounded-lg bg-muted p-2 text-[11px]">
        {JSON.stringify(plan, null, 2)}
      </pre>
    </details>
  );
}
