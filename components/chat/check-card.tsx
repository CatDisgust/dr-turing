"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useState,
} from "react";
import type { TurnSignal } from "@/lib/learner/policy";
import type { CheckCard, Confidence } from "@/lib/types";
import { PickButton } from "./pick-button";
import { useTutorActions } from "./tutor-actions";

// 检查题（交互方案 D，视觉规范 CheckQuestion + AnswerBar）：题面留在对话里，
// 作答区固定在对话列底部，换掉平时的输入框。只有最新一条回答里的题能答。都会记下来：
// 给提示 → 这题再答对按 d = 0.5；直接告诉我 → d = 0，并计入投入度；先不做题 → 计入投入度

const KIND = {
  check: "检查一下",
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

// 对话里的题面：小标签 + 18px 粗体题干，不加卡片框
export function CheckCardView({ card }: { card: CheckCard }) {
  return (
    <div className="flex flex-col gap-1" data-testid="check-card">
      <span className="text-[13px] text-muted-foreground leading-normal">
        {KIND[card.kind]}
        {card.retry ? " · 再试一次" : ""}
      </span>
      <p className="font-bold text-[18px] leading-[1.55]">{card.question}</p>
    </div>
  );
}

// 底部作答区：输入框 + 你有多确定 + 求助 + 交卷。回答框和平时的输入框共用一份文字，
// 划词“问这句”、小模拟“在输入框里写”放进来的字在这里也看得到
export function AnswerBar({
  card,
  input,
  setInput,
}: {
  card: CheckCard;
  input: string;
  setInput: (text: string) => void;
}) {
  const actions = useTutorActions();
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const disabled = !actions || actions.disabled;
  // 摸底题不走 PendingQuestion，提示和答案按钮没有意义；也不问把握
  const diagnosis = card.kind === "diagnosis";
  const help = diagnosis ? HELP.filter((h) => h.signal === "skip") : HELP;

  const submit = useCallback(() => {
    const text = input.trim();
    if (!(text && actions)) {
      return;
    }
    actions.send(text, confidence ? { confidence } : undefined);
    setInput("");
  }, [actions, input, confidence, setInput]);
  const type = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value),
    [setInput]
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
    <div className="flex flex-col gap-3" data-testid="answer-bar">
      <label className="sr-only" htmlFor="check-answer">
        你的回答
      </label>
      <textarea
        className="dt-input w-full resize-none px-3.5 py-2.5"
        data-testid="check-answer"
        disabled={disabled}
        id="check-answer"
        onChange={type}
        onKeyDown={enter}
        placeholder="用你自己的话回答"
        rows={2}
        value={input}
      />
      <div className="flex flex-wrap items-center gap-2">
        {diagnosis ? null : (
          <div
            aria-label="你有多确定"
            className="flex items-center gap-2"
            role="radiogroup"
          >
            <span className="mr-0.5 text-[14px] text-muted-foreground">
              你有多确定
            </span>
            {CONFIDENCE.map((c) => (
              <PickButton
                aria-checked={confidence === c.value}
                className="dt-btn"
                data-testid={`confidence-${c.value}`}
                disabled={disabled}
                key={c.value}
                onPick={pickConfidence}
                role="radio"
                value={c.value}
              >
                {c.label}
              </PickButton>
            ))}
          </div>
        )}
        <span className="flex-1" />
        {help.map((h) => (
          <PickButton
            className="dt-text-btn"
            data-testid={`quick-${h.signal}`}
            disabled={disabled}
            key={h.signal}
            onPick={askHelp}
            value={h}
          >
            {h.label}
          </PickButton>
        ))}
        <button
          className="dt-btn dt-btn-primary ml-1.5"
          data-testid="check-submit"
          disabled={disabled || input.trim() === ""}
          onClick={submit}
          type="button"
        >
          交卷
        </button>
      </div>
    </div>
  );
}
