"use client";

import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

// 回答开头一行批改结果（交互方案 D）。学生交卷前说了把握，就把把握和结果摆在一起：
// 说“很确定”却答错，正是“以为自己会了”的地方

type Graded = Extract<
  ChatMessage["parts"][number],
  { type: "data-graded" }
>["data"];

function calibration({ correct, confidence }: Graded): string | null {
  if (!confidence) {
    return null;
  }
  if (correct) {
    if (confidence === "sure") {
      return "和你说的「很确定」对得上。";
    }
    if (confidence === "guess") {
      return "你说是猜的：答对了，也先别急着算会。";
    }
    return null;
  }
  if (confidence === "sure") {
    return "你交卷前说「很确定」。这就是以为自己会了的地方，正好现在弄清楚。";
  }
  return null;
}

export function GradedLine({ graded }: { graded: Graded }) {
  const note = calibration(graded);
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-lg px-3 py-2 text-xs",
        graded.correct
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-red-500/10 text-red-700 dark:text-red-400"
      )}
      data-testid="graded-line"
    >
      <span className="font-medium">
        {graded.correct ? "✓ 答对了" : "✗ 这题还没答对"} · {graded.name}
      </span>
      {note ? <span>{note}</span> : null}
    </div>
  );
}
