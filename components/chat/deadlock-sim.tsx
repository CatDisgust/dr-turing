"use client";

import { useCallback, useState } from "react";
import {
  initialSim,
  type Lock,
  type SimState,
  STEPS,
  stepSim,
  type Txn,
} from "@/lib/tutor/deadlock-sim";
import { cn } from "@/lib/utils";
import { PickButton } from "./pick-button";
import { useTutorActions } from "./tutor-actions";

const EXPLAIN_START = "我试了死锁模拟：第二次没卡死，是因为";

// 回答里嵌的死锁小模拟（交互方案 C）：学生当调度器，先亲手造出死锁，再换个顺序让两个都做完，
// 最后用一句话说为什么。只在界面里跑，结果不进学生模型；那句话发出去照常走对话

const TXNS: Txn[] = [1, 2];
const LOCKS: Lock[] = ["A", "B"];

function statusText(s: SimState, last: Txn | null): string {
  if (s.outcome === "deadlock") {
    return "卡死了：T1 拿着 A 等 B，T2 拿着 B 等 A，谁也走不动。这就是死锁。点“重来”换个顺序。";
  }
  if (s.outcome === "finished") {
    return "两个都做完了。注意你这次是怎么排的。";
  }
  if (last === null) {
    return "还没开始。";
  }
  if (s.waiting[last]) {
    return `T${last} 要的锁在 T${last === 1 ? 2 : 1} 手里，只能等。`;
  }
  return `T${last}：${STEPS[last][s.pc[last] - 1]}。`;
}

export function DeadlockSim() {
  const actions = useTutorActions();
  const [sim, setSim] = useState(initialSim);
  const [last, setLast] = useState<Txn | null>(null);
  const [hit, setHit] = useState({ deadlock: false, finished: false });

  const step = useCallback(
    (t: Txn) => {
      const next = stepSim(sim, t);
      setSim(next);
      setLast(t);
      if (next.outcome !== "running") {
        setHit((h) => ({ ...h, [next.outcome]: true }));
      }
    },
    [sim]
  );
  const reset = useCallback(() => {
    setSim(initialSim());
    setLast(null);
  }, []);
  const explain = useCallback(
    () => actions?.fillInput(EXPLAIN_START),
    [actions]
  );
  const both = hit.deadlock && hit.finished;

  return (
    <div
      className="flex flex-col gap-2.5 rounded-2xl border-2 px-[18px] py-3.5 text-[14px] leading-normal"
      data-testid="deadlock-sim"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold text-[15px]">动手试试：你来当调度器</span>
        <span className="flex gap-3 text-[13px]">
          <Goal done={hit.deadlock} label="造出一次死锁" />
          <Goal done={hit.finished} label="让两个都做完" />
        </span>
      </div>
      <p className="leading-[1.6]">
        每次点一下，让 T1 或 T2
        走一步。先试着让它们卡死，再换一种顺序让它们都做完。
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {TXNS.map((t) => (
          <div className="flex min-w-0 flex-col gap-1.5" key={t}>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">T{t}</span>
              <PickButton
                className="dt-btn dt-btn-sm"
                data-testid={`sim-step-${t}`}
                disabled={sim.outcome !== "running" || sim.pc[t] >= 3}
                onPick={step}
                value={t}
              >
                走一步
              </PickButton>
            </div>
            {STEPS[t].map((label, i) => {
              const done = i < sim.pc[t];
              const stuck = i === sim.pc[t] && sim.waiting[t];
              return (
                <div
                  className={cn(
                    "rounded-[10px] px-2.5 py-[5px]",
                    done && "bg-muted",
                    stuck &&
                      "border-[1.5px] border-[var(--placeholder)] border-dashed py-1",
                    !(done || stuck) && "text-muted-foreground"
                  )}
                  key={label}
                >
                  {label}
                  {stuck ? " · 等待中" : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[13px] text-muted-foreground">
        {LOCKS.map((l) => (
          <span key={l}>
            锁 {l}：{sim.owner[l] ? `T${sim.owner[l]}` : "空"}
          </span>
        ))}
        <button
          className="dt-text-btn ml-auto h-8"
          onClick={reset}
          type="button"
        >
          重来
        </button>
      </div>
      <p
        className={cn(
          "flex items-start gap-2 leading-[1.6]",
          sim.outcome === "running" && "text-muted-foreground"
        )}
        data-testid="sim-status"
      >
        {sim.outcome === "running" ? null : <Check />}
        <span>{statusText(sim, last)}</span>
      </p>
      {both ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex-1">
            两种你都做出来了。用一句话说说：第二次为什么没卡死？
          </span>
          {actions ? (
            <button
              className="dt-btn dt-btn-sm"
              disabled={actions.disabled}
              onClick={explain}
              type="button"
            >
              在输入框里写
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// 达成了就是“对”：绿色对勾（视觉规范：做出死锁也是做对了，不用红）
function Check() {
  return (
    <svg
      aria-hidden="true"
      className="mt-[3px] shrink-0"
      fill="none"
      height="18"
      stroke="var(--duo-green-check)"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="3"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function Goal({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1",
        done ? "text-foreground" : "text-muted-foreground"
      )}
    >
      {done ? (
        <Check />
      ) : (
        <span className="inline-block size-2.5 rounded-full border-2 border-current" />
      )}
      {label}
    </span>
  );
}
