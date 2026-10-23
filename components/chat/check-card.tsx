"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useState,
} from "react";
import type { TurnSignal } from "@/lib/learner/policy";
import type { CheckCard, Confidence } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PickButton } from "./pick-button";
import { useTutorActions } from "./tutor-actions";

// 检查题卡片（交互方案 D）：题、作答框、“你有多确定”、三个求助按钮都在卡里。
// 只有最新一条回答里的卡能答；旧卡只留题面。都会记下来：
// 给提示 → 这题再答对按 d = 0.5；直接告诉我 → d = 0，并计入投入度；先不做题 → 计入投入度

const KIND = {
  check: "检查题",
  diagnosis: "摸底题",
  review: "复习题",
  variant: "变式题",
} as const;

const CONFIDENCE: { value: Confidence; label: string }[] = [
  { label: "猜的", value: "guess" },
  { label: "有点把握", value: "somewhat" },
  { label: "很确定", value: "sure" },
];

const HELP: { signal: TurnSignal; label: string; text: string }[] = [
  { label: "给提示", signal: "hint", text: "给我一点提示" },
  { label: "直接告诉我", signal: "just_tell_me", text: "直接告诉我答案吧" },
  { label: "先不做题", signal: "skip", text: "这题先不做了" },
];

export function CheckCardView({
  card,
  active,
}: {
  card: CheckCard;
  active: boolean;
}) {
  const actions = useTutorActions();
  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const live = active && actions !== null;
  const disabled = !live || actions.disabled;
  // 摸底题不走 PendingQuestion，提示和答案按钮没有意义；也不问把握
  const diagnosis = card.kind === "diagnosis";
  const help = diagnosis ? HELP.filter((h) => h.signal === "skip") : HELP;

  const submit = useCallback(() => {
    const text = answer.trim();
    if (!(text && actions)) {
      return;
    }
    actions.send(text, confidence ? { confidence } : undefined);
  }, [actions, answer, confidence]);
  const type = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => setAnswer(e.target.value),
    []
  );
  // 回车交卷，Shift+回车换行；输入法选字时的回车不算
  const enter = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        submit();
      }
    },
    [submit]
  );
  const pickConfidence = useCallback(
    (value: Confidence) =>
      setConfidence((current) => (current === value ? null : value)),
    []
  );
  const askHelp = useCallback(
    (h: (typeof HELP)[number]) => actions?.send(h.text, { signal: h.signal }),
    [actions]
  );

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-3.5 text-[13px]"
      data-testid="check-card"
    >
      <div className="flex items-center justify-between text-muted-foreground text-xs">
        <span>
          {KIND[card.kind]}
          {card.name ? ` · ${card.name}` : ""}
          {card.retry ? " · 再试一次" : ""}
        </span>
      </div>
      <p className="text-[14px] leading-[1.65]">{card.question}</p>
      {live ? (
        <>
          <textarea
            className="min-h-[3.5rem] w-full resize-y rounded-lg border bg-background px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="check-answer"
            disabled={disabled}
            onChange={type}
            onKeyDown={enter}
            placeholder="用自己的话答，一两句就行"
            value={answer}
          />
          {diagnosis ? null : (
            <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
              <span className="mr-1">你有多确定？</span>
              {CONFIDENCE.map((c) => (
                <PickButton
                  className={cn(
                    "rounded-md border px-2.5 py-0.5 disabled:opacity-50",
                    confidence === c.value
                      ? "border-foreground/40 bg-foreground/10 text-foreground"
                      : "hover:bg-muted hover:text-foreground"
                  )}
                  data-testid={`confidence-${c.value}`}
                  disabled={disabled}
                  key={c.value}
                  onPick={pickConfidence}
                  value={c.value}
                >
                  {c.label}
                </PickButton>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-lg bg-foreground px-3.5 py-1 text-background text-xs disabled:opacity-40"
              data-testid="check-submit"
              disabled={disabled || answer.trim() === ""}
              onClick={submit}
              type="button"
            >
              交上去
            </button>
            {help.map((h) => (
              <PickButton
                className="rounded-full border px-3 py-1 text-muted-foreground text-xs hover:bg-muted hover:text-foreground disabled:opacity-50"
                data-testid={`quick-${h.signal}`}
                disabled={disabled}
                key={h.signal}
                onPick={askHelp}
                value={h}
              >
                {h.label}
              </PickButton>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
