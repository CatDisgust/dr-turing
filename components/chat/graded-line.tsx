"use client";

import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

// 交卷后的结果横幅（视觉规范 Verdict），放在这一轮回答最上面。学生交卷前说了把握，
// 就把把握和结果摆在一起：说“很确定”却答错，正是“以为学会了”的地方

type Graded = Extract<
  ChatMessage["parts"][number],
  { type: "data-graded" }
>["data"];

function verdictText(graded: Graded): { title: string; detail: string } {
  const { correct, confidence, misconception, name } = graded;
  if (correct) {
    if (confidence === "sure") {
      return { detail: "和你说的「很确定」对得上。", title: "答对了。" };
    }
    if (confidence === "guess") {
      return {
        detail: "你说是猜的：答对了，也先别急着算会。",
        title: "答对了。",
      };
    }
    return { detail: `「${name}」记下了一次答对。`, title: "答对了。" };
  }
  const noted = misconception
    ? `我记下了你的想法：${misconception.replace(/[。.]+$/, "")}。`
    : "";
  if (confidence === "sure") {
    return {
      detail: `这就是「以为学会了」。${noted}下面我们换个角度把它弄清楚。`,
      title: "你很确定，但答错了。",
    };
  }
  return {
    detail: `${noted}下面我们一起把它弄清楚。`,
    title: "还差一点。",
  };
}

export function GradedLine({ graded }: { graded: Graded }) {
  const { title, detail } = verdictText(graded);
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-2xl px-5 py-4",
        graded.correct
          ? "bg-[var(--duo-green-soft)]"
          : "bg-[var(--duo-red-soft)]"
      )}
      data-testid="graded-line"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-background">
        {graded.correct ? (
          <svg
            aria-hidden="true"
            fill="none"
            height="24"
            stroke="var(--duo-green-check)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
            viewBox="0 0 24 24"
            width="24"
          >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        ) : (
          <svg
            aria-hidden="true"
            fill="none"
            height="24"
            stroke="var(--duo-red-icon)"
            strokeLinecap="round"
            strokeWidth="3.2"
            viewBox="0 0 24 24"
            width="24"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span
          className={cn(
            "font-bold text-[22px] leading-[1.4]",
            graded.correct
              ? "text-[var(--duo-green-ink)]"
              : "text-[var(--duo-red-ink)]"
          )}
        >
          {title}
        </span>
        {detail ? (
          <span
            className={cn(
              "text-[15px] leading-[1.6]",
              graded.correct ? "text-foreground" : "text-[var(--duo-red-ink-2)]"
            )}
          >
            {detail}
          </span>
        ) : null}
      </div>
    </div>
  );
}
