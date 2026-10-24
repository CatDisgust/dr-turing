"use client";

import { PersonalPanel } from "@/components/graph/personal-panel";

// 不选课的对话（2026-10-24）：没有课程星图，右边只说明聊到的概念会记进我的星图
export function FreeGraph() {
  return (
    <div
      className="relative flex h-full w-full flex-col justify-center gap-2 bg-[var(--sky)] px-[22px] text-[var(--sky-ink)]"
      data-testid="free-graph"
    >
      <p className="text-[16px] text-white">这次没选课</p>
      <p className="text-[14px] text-[var(--sky-ink-2)] leading-relaxed">
        随便问。聊到的概念在点「结束本次学习」后会记进右上角的「我的星图」。
      </p>
      <PersonalPanel />
    </div>
  );
}
