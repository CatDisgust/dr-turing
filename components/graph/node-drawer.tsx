"use client";

import { FULL_O, HALF_M } from "@/lib/learner/config";
import { nodeLight } from "@/lib/learner/light";
import type {
  Attempt,
  KnowledgePoint,
  LearningStage,
  NodeState,
} from "@/lib/types";

// 点一个节点看它为什么是现在这个亮度：M、O、每条证据的原话、记下的误解

const LIGHT_LABEL = {
  dashed: "这次问到了",
  full: "全亮：隔天还会",
  gray: "没学过",
  half: "半亮：理解了",
} as const;

const STAGE_LABEL: Record<LearningStage, string> = {
  correct_with_help: "靠提示做对过",
  explained: "讲过了",
  independent: "能独立做对",
  not_covered: "还没学",
  practiced_unproven: "练过，还没证明",
};

const TYPE_LABEL: Record<Attempt["type"], string> = {
  asked_help: "求助",
  check_correct: "检查题答对",
  check_wrong: "检查题答错",
  review_correct: "隔天复习答对",
  said_understood: "说懂了",
  self_explained: "自己讲出来",
  transfer_correct: "变式题答对",
};

const MISCONCEPTION_LABEL = {
  confirmed: "已确认",
  repaired: "已纠正",
  suspected: "疑似",
} as const;

function helpLabel(attempt: Attempt) {
  if (!attempt.hinted) {
    return "独立";
  }
  return attempt.d === 0 ? "看过答案" : "要过提示";
}

function Bar({
  label,
  value,
  mark,
}: {
  label: string;
  value: number;
  mark: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0">{label}</span>
      <div className="relative h-2 flex-1 rounded bg-muted">
        <div
          className="h-2 rounded bg-amber-500"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
        <div
          className="absolute top-[-3px] h-3.5 w-px bg-foreground/60"
          style={{ left: `${mark * 100}%` }}
        />
      </div>
      <span className="w-10 text-right tabular-nums">{value.toFixed(2)}</span>
    </div>
  );
}

export function NodeDrawer({
  point,
  node,
  sessionId,
  onClose,
}: {
  point: KnowledgePoint;
  node: NodeState | undefined;
  sessionId: string;
  onClose: () => void;
}) {
  const { light, provisional } = nodeLight(node, sessionId);
  const attempts = [...(node?.attempts ?? [])].reverse();
  return (
    <aside
      className="absolute inset-y-0 right-0 z-10 flex w-[85%] max-w-sm flex-col gap-4 overflow-y-auto border-l bg-background p-4 text-sm shadow-lg"
      data-testid="node-drawer"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h3 className="font-semibold text-base">{point.name}</h3>
          <p className="text-muted-foreground text-xs">
            {LIGHT_LABEL[light]}
            {provisional ? " · 有暂定证据，会后复核" : ""}
            {node ? ` · ${STAGE_LABEL[node.stage]}` : ""}
          </p>
        </div>
        <button
          className="rounded px-2 text-muted-foreground hover:bg-muted"
          onClick={onClose}
          type="button"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-1.5 text-xs">
        <Bar label="表面掌握 M" mark={HALF_M} value={node?.M ?? 0} />
        <Bar label="自主掌握 O" mark={FULL_O} value={node?.O ?? 0} />
        <p className="text-muted-foreground">
          竖线是门槛：M 过 {HALF_M} 半亮，O 过 {FULL_O} 全亮。
        </p>
      </div>

      <section>
        <h4 className="mb-1 font-medium">证据</h4>
        {attempts.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            还没有答过这个点的题。
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="evidence">
            {attempts.map((attempt) => (
              <li className="rounded-md border p-2" key={attempt.id}>
                <div className="flex flex-wrap gap-x-2 text-muted-foreground text-xs">
                  <span
                    className={
                      attempt.correct === false
                        ? "text-red-600"
                        : "text-emerald-600"
                    }
                  >
                    {TYPE_LABEL[attempt.type]}
                  </span>
                  <span>{helpLabel(attempt)}</span>
                  {attempt.provisional ? <span>暂定</span> : null}
                  <span>{new Date(attempt.at).toLocaleString()}</span>
                </div>
                <p className="mt-1">「{attempt.quote}」</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {node?.retracted && node.retracted.length > 0 ? (
        <section>
          <h4 className="mb-1 font-medium">会后复核撤掉的证据</h4>
          <ul className="flex flex-col gap-2" data-testid="retracted">
            {node.retracted.map((r) => (
              <li
                className="rounded-md border border-dashed p-2 text-xs"
                key={r.attempt.id}
              >
                <div className="text-muted-foreground line-through">
                  {TYPE_LABEL[r.attempt.type]}「{r.attempt.quote}」
                </div>
                <div className="mt-1">撤销原因：{r.reason}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {node && node.misconceptions.length > 0 ? (
        <section>
          <h4 className="mb-1 font-medium">他的错误想法（从他的错答里提的）</h4>
          <ul className="flex flex-col gap-2" data-testid="misconceptions">
            {node.misconceptions.map((m) => (
              <li className="rounded-md border p-2 text-xs" key={m.id}>
                <div>
                  {MISCONCEPTION_LABEL[m.status]}：{m.text}
                </div>
                <div className="mt-1 text-muted-foreground">
                  最近一次：「{m.lastQuote}」
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="text-muted-foreground text-xs">
        <h4 className="mb-1 font-medium text-foreground text-sm">定义</h4>
        {point.definition}
      </section>
    </aside>
  );
}
