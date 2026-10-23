"use client";

import { useCallback } from "react";
import { PickButton } from "./pick-button";
import { type SendBody, useTutorActions } from "./tutor-actions";

// 回答下的追问按钮（交互方案 E）。前三个就是替学生打字，规划器照旧从这句话里认出
// “太抽象”“还是不懂”；“我懂了，考我”让服务端直接出一道独立题
const FOLLOW_UPS: { label: string; text: string; body?: SendBody }[] = [
  { label: "举个例子", text: "能举个具体的例子吗？" },
  { label: "太抽象了", text: "太抽象了" },
  { label: "还是不懂", text: "还是不懂" },
  { body: { quizMe: true }, label: "我懂了，考我", text: "我懂了，考考我" },
];

export function FollowUps() {
  const actions = useTutorActions();
  const send = useCallback(
    (f: (typeof FOLLOW_UPS)[number]) => actions?.send(f.text, f.body),
    [actions]
  );
  if (!actions) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2 pt-1" data-testid="follow-ups">
      {FOLLOW_UPS.map((f) => (
        <PickButton
          className="dt-btn dt-btn-sm"
          disabled={actions.disabled}
          key={f.label}
          onPick={send}
          value={f}
        >
          {f.label}
        </PickButton>
      ))}
    </div>
  );
}
