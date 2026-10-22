"use client";

import { useCallback } from "react";
import { useLearnerState } from "@/hooks/use-learner-state";
import type { TurnSignal } from "@/lib/learner/policy";

// 有题等着答的时候，输入框上面三个按钮。都会记下来：
// 给提示 → 这题再答对按 d = 0.5；直接告诉我 → d = 0，并计入投入度；先不做题 → 计入投入度
const ACTIONS: { signal: TurnSignal; label: string; text: string }[] = [
  { label: "给提示", signal: "hint", text: "给我一点提示" },
  { label: "直接告诉我", signal: "just_tell_me", text: "直接告诉我答案吧" },
  { label: "先不做题", signal: "skip", text: "这题先不做了" },
];

export function QuickActions({
  sessionId,
  disabled,
  onSignal,
}: {
  sessionId: string;
  disabled: boolean;
  onSignal: (text: string, signal: TurnSignal) => void;
}) {
  const state = useLearnerState();
  const pending = state?.pendingQuestion;
  if (pending?.sessionId !== sessionId) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2" data-testid="quick-actions">
      {ACTIONS.map((action) => (
        <ActionButton
          action={action}
          disabled={disabled}
          key={action.signal}
          onSignal={onSignal}
        />
      ))}
    </div>
  );
}

function ActionButton({
  action,
  disabled,
  onSignal,
}: {
  action: (typeof ACTIONS)[number];
  disabled: boolean;
  onSignal: (text: string, signal: TurnSignal) => void;
}) {
  const click = useCallback(
    () => onSignal(action.text, action.signal),
    [action, onSignal]
  );
  return (
    <button
      className="rounded-full border px-3 py-1 text-muted-foreground text-xs hover:bg-muted hover:text-foreground disabled:opacity-50"
      data-testid={`quick-${action.signal}`}
      disabled={disabled}
      onClick={click}
      type="button"
    >
      {action.label}
    </button>
  );
}
