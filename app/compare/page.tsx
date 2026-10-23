"use client";

import { useCallback, useState } from "react";
import type { ComparedField, CompareVerdict } from "@/lib/demo/compare";
import { DEMO_QUESTION } from "@/lib/demo/seed";
import type { TutorPlan } from "@/lib/types";

type Result = {
  question: string;
  target: { id: string; name: string };
  names: Record<string, string>;
  runs: { a: TutorPlan; b: TutorPlan }[];
  verdict: CompareVerdict;
};

type SeedResult = {
  target: { id: string; name: string };
  misconception: string | null;
  prereqs: { id: string; name: string; aM: number; bM: number }[];
  scene2: { name: string; M: number; O: number } | null;
};

type NextDayResult = { name: string; M: number; O: number; light: string };
type ResetResult = { name: string; full: number; half: number };

const FIELD_LABELS: Record<ComparedField, string> = {
  check_misconception_first: "先查误解吗",
  disclosure_level: "讲到多少",
  elicits_production: "让学生自己推一步吗",
  start_from: "从哪些已会的点讲起",
};

const DISCLOSURE: Record<TutorPlan["disclosure_level"], string> = {
  full: "full（完整讲清）",
  hint: "hint（给一步提示）",
  partial: "partial（讲一部分，留一步让他推）",
  question: "question（只提问）",
};

function show(
  plan: TutorPlan,
  field: ComparedField,
  names: Record<string, string>
): string {
  if (field === "start_from") {
    return plan.start_from.length > 0
      ? plan.start_from.map((id) => `「${names[id] ?? id}」`).join("")
      : "（无，从头讲）";
  }
  if (field === "disclosure_level") {
    return DISCLOSURE[plan.disclosure_level];
  }
  if (field === "elicits_production") {
    return plan.elicits_production ? "是" : "否";
  }
  return plan.check_misconception_first
    ? `是：${plan.check_misconception_first}`
    : "否";
}

async function post<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  // 函数超时或崩溃时返回的不是 JSON，把状态码和原文显示出来
  const text = await response.text();
  let json: { error?: string } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!(response.ok && json)) {
    throw new Error(
      json?.error ??
        `请求失败（${response.status}）${text.slice(0, 200) || "，没有返回内容"}`
    );
  }
  return json as T;
}

// 画面三（D11）：同一句话，学生 A、B 各拿到一份规划
export default function ComparePage() {
  const [question, setQuestion] = useState(DEMO_QUESTION);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [seed, setSeed] = useState<SeedResult | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [nextDay, setNextDay] = useState<NextDayResult | null>(null);
  const [showNote, setShowNote] = useState("");

  const writeSeed = useCallback(async () => {
    setBusy("seed");
    setError("");
    try {
      setSeed(await post<SeedResult>("/api/demo/seed", {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }, []);

  // 演示视频的“第二天”：演示学生的死锁变成昨天学过、半亮
  const writeNextDay = useCallback(async () => {
    setBusy("next-day");
    setError("");
    try {
      setNextDay(await post<NextDayResult>("/api/demo/next-day", {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }, []);

  // 产品演示学生（录视频用）：清空重来，或者给他写“第二天”
  const resetShow = useCallback(async () => {
    setBusy("show-reset");
    setError("");
    try {
      const r = await post<ResetResult>("/api/demo/reset", {});
      setShowNote(
        `${r.name}已清空重来：旧对话、个人星图、学生模型都删了，课内 ${r.full} 个全亮、${r.half} 个半亮（丢失更新昨天半亮，死锁没碰）。`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }, []);

  const showNextDay = useCallback(async () => {
    setBusy("show-next-day");
    setError("");
    try {
      const r = await post<NextDayResult>("/api/demo/next-day", {
        student: "show",
      });
      setShowNote(
        `产品演示学生的“第二天”已写入：「${r.name}」昨天学过（M ${r.M.toFixed(2)}，O ${r.O.toFixed(2)}，${r.light === "half" ? "半亮" : r.light}），今天问到它会出复习题。`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }, []);

  const compare = useCallback(
    async (runs: number) => {
      setBusy(`compare${runs}`);
      setError("");
      try {
        setResult(await post<Result>("/api/demo/compare", { question, runs }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy("");
      }
    },
    [question]
  );
  const compareOnce = useCallback(() => compare(1), [compare]);
  const compareFive = useCallback(() => compare(5), [compare]);
  const onQuestion = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setQuestion(e.target.value),
    []
  );

  const first = result?.runs[0];
  const verdict = result?.verdict;

  return (
    <main className="mx-auto max-w-5xl p-8 text-sm">
      <h1 className="mb-2 font-semibold text-xl">规划对比：学生 A / 学生 B</h1>
      <p className="mb-4 text-muted-foreground">
        两个学生问同一句话。A 的前置都独立答对过、隔天也还会；B
        的前置要过提示才做对，在这个点上还答错过一次。下面是系统给两人定的这一轮怎么教。
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="min-w-72 flex-1 rounded-md border px-3 py-1.5"
          data-testid="compare-question"
          onChange={onQuestion}
          value={question}
        />
        <button
          className="rounded-md border px-3 py-1.5 disabled:opacity-50"
          data-testid="seed"
          disabled={busy !== ""}
          onClick={writeSeed}
          type="button"
        >
          {busy === "seed" ? "写入中…" : "写入预置数据"}
        </button>
        <button
          className="rounded-md border px-3 py-1.5 disabled:opacity-50"
          data-testid="next-day"
          disabled={busy !== ""}
          onClick={writeNextDay}
          type="button"
        >
          {busy === "next-day" ? "写入中…" : "写入“第二天”（死锁）"}
        </button>
        <button
          className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50"
          data-testid="compare-once"
          disabled={busy !== ""}
          onClick={compareOnce}
          type="button"
        >
          {busy === "compare1" ? "规划中…" : "对比一次"}
        </button>
        <button
          className="rounded-md border px-3 py-1.5 disabled:opacity-50"
          data-testid="compare-five"
          disabled={busy !== ""}
          onClick={compareFive}
          type="button"
        >
          {busy === "compare5" ? "跑着呢…" : "连跑 5 次"}
        </button>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">
          产品演示学生（录视频用）：
        </span>
        <button
          className="rounded-md border px-3 py-1.5 disabled:opacity-50"
          data-testid="show-reset"
          disabled={busy !== ""}
          onClick={resetShow}
          type="button"
        >
          {busy === "show-reset" ? "重置中…" : "清空重来"}
        </button>
        <button
          className="rounded-md border px-3 py-1.5 disabled:opacity-50"
          data-testid="show-next-day"
          disabled={busy !== ""}
          onClick={showNextDay}
          type="button"
        >
          {busy === "show-next-day" ? "写入中…" : "写入“第二天”（死锁）"}
        </button>
      </div>
      {error ? <p className="mb-3 text-destructive">{error}</p> : null}
      {showNote ? (
        <p className="mb-4 text-muted-foreground" data-testid="show-result">
          {showNote}
        </p>
      ) : null}

      {seed ? (
        <p className="mb-4 text-muted-foreground" data-testid="seed-result">
          已写入。目标点「{seed.target.name}」，两跳内前置 {seed.prereqs.length}{" "}
          个：
          {seed.prereqs
            .map(
              (p) => `「${p.name}」A ${p.aM.toFixed(2)} / B ${p.bM.toFixed(2)}`
            )
            .join("，") || "（没有）"}
          。
          {seed.misconception
            ? `B 的错误想法（从他的错答里提的）：${seed.misconception}`
            : null}
          <br />
          {seed.scene2
            ? `画面二：演示学生的「${seed.scene2.name}」昨天已半亮（M ${seed.scene2.M.toFixed(2)}，O ${seed.scene2.O.toFixed(2)}），今天问到它会出复习题，独立答对就全亮。`
            : "画面二：图谱里找不到「丢失更新」，没写。"}
        </p>
      ) : null}

      {nextDay ? (
        <p className="mb-4 text-muted-foreground" data-testid="next-day-result">
          “第二天”已写入：演示学生的「{nextDay.name}」昨天学过（M{" "}
          {nextDay.M.toFixed(2)}，O {nextDay.O.toFixed(2)}，
          {nextDay.light === "half" ? "半亮" : nextDay.light}
          ），今天问到它会出复习题，独立答对就全亮。
        </p>
      ) : null}

      {result && first && verdict ? (
        <>
          <p className="mb-3 font-medium text-base" data-testid="verdict">
            「{result.question}」归到「{result.target.name}」。
            {result.runs.length} 次里每次都不同的有 {verdict.alwaysDifferent} 项
            {verdict.stable ? "，方向没变" : "，有一项方向变了"}
            {verdict.pass
              ? " ✓ 达标"
              : " ✗ 未达标（要求至少 3 项不同、方向不变）"}
          </p>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 pr-2">这一项</th>
                <th className="py-1 pr-2">学生 A</th>
                <th className="py-1 pr-2">学生 B</th>
                <th className="py-1">{result.runs.length} 次里不同几次</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b align-top">
                <td className="py-1 pr-2">动作（规则定的）</td>
                <td className="py-1 pr-2">
                  {first.a.next_action}（规则{first.a.rule}）·「
                  {result.names[first.a.target_kc] ?? first.a.target_kc}」
                </td>
                <td className="py-1 pr-2">
                  {first.b.next_action}（规则{first.b.rule}）·「
                  {result.names[first.b.target_kc] ?? first.b.target_kc}」
                </td>
                <td className="py-1" />
              </tr>
              {verdict.fields.map((f) => (
                <tr
                  className={`border-b align-top ${f.stable ? "" : "bg-red-50 dark:bg-red-950/30"}`}
                  key={f.field}
                >
                  <td className="py-1 pr-2">
                    {FIELD_LABELS[f.field]}
                    <div className="text-muted-foreground text-xs">
                      {f.field}
                    </div>
                  </td>
                  <td className="py-1 pr-2">
                    {show(first.a, f.field, result.names)}
                  </td>
                  <td className="py-1 pr-2">
                    {show(first.b, f.field, result.names)}
                  </td>
                  <td className="py-1">
                    {f.differentRuns}/{result.runs.length}
                  </td>
                </tr>
              ))}
              <tr className="align-top">
                <td className="py-1 pr-2">理由</td>
                <td className="py-1 pr-2">{first.a.rationale}</td>
                <td className="py-1 pr-2">{first.b.rationale}</td>
                <td className="py-1" />
              </tr>
            </tbody>
          </table>
          <details className="mt-4">
            <summary className="cursor-pointer text-muted-foreground">
              两份规划的原始 JSON（第 1 次）
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(first.a, null, 2)}
              </pre>
              <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(first.b, null, 2)}
              </pre>
            </div>
          </details>
        </>
      ) : null}
    </main>
  );
}
