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
      className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-3.5 text-[13px]"
      data-testid="deadlock-sim"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">动手试试 · 你来当调度器</span>
        <span className="flex gap-3">
          <Goal done={hit.deadlock} label="造出一次死锁" />
          <Goal done={hit.finished} label="让两个都做完" />
        </span>
      </div>
      <p>
        每次点一下，让 T1 或 T2
        走一步。先试着让它们卡死，再换一种顺序让它们都做完。
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {TXNS.map((t) => (
          <div
            className="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-background p-2.5"
            key={t}
          >
            <div className="flex items-center justify-between font-mono text-xs">
              <span>T{t}</span>
              <PickButton
                className="rounded-full border border-foreground/30 px-2.5 py-0.5 hover:bg-muted disabled:opacity-40"
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
                    "rounded-md border px-2 py-1 font-mono text-xs",
                    done &&
                      "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                    stuck &&
                      (sim.outcome === "deadlock"
                        ? "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-400"
                        : "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400")
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
      <div className="flex flex-wrap items-center gap-4 font-mono text-muted-foreground text-xs">
        {LOCKS.map((l) => (
          <span key={l}>
            锁 {l}：{sim.owner[l] ? `T${sim.owner[l]}` : "空"}
          </span>
        ))}
        <button
          className="ml-auto rounded-md border px-2.5 py-0.5 hover:bg-muted"
          onClick={reset}
          type="button"
        >
          重来
        </button>
      </div>
      <p
        className={cn(
          "rounded-lg px-3 py-2",
          sim.outcome === "deadlock"
            ? "bg-red-500/10 text-red-700 dark:text-red-400"
            : sim.outcome === "finished"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-background"
        )}
        data-testid="sim-status"
      >
        {statusText(sim, last)}
      </p>
      {both ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>两种你都做出来了。用一句话说说：第二次为什么没卡死？</span>
          {actions ? (
            <button
              className="rounded-full border px-3 py-1 text-muted-foreground text-xs hover:bg-muted hover:text-foreground disabled:opacity-50"
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

function Goal({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5",
        done
          ? "text-emerald-700 dark:text-emerald-400"
          : "text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "inline-block size-2.5 rounded-full border-2",
          done ? "border-emerald-500 bg-emerald-500" : "border-current"
        )}
      />
      {label}
    </span>
  );
}
