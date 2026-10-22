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
};

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
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error ?? `请求失败（${response.status}）`);
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
      {error ? <p className="mb-3 text-destructive">{error}</p> : null}

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
            ? `B 的误解：${seed.misconception}`
            : "这个点没有写误解，B 不会触发查误解。"}
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
