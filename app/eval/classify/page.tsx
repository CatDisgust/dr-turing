"use client";

import { useCallback, useState } from "react";

type Row = {
  question: string;
  accept: string[] | null;
  got: string | null;
  ok: boolean;
  ms: number;
  error?: string;
};

const CONCURRENCY = 4;

// 快路径归类评测：20 条手写提问，目标准确率 ≥ 85%
export default function ClassifyEvalPage() {
  const [rows, setRows] = useState<(Row | null)[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(async () => {
    setRunning(true);
    setError("");
    try {
      const { total } = await (
        await fetch("/api/eval/classify?index=-1")
      ).json();
      const results: (Row | null)[] = new Array(total).fill(null);
      setRows([...results]);
      let next = 0;
      const worker = async () => {
        while (next < total) {
          const index = next;
          next += 1;
          // biome-ignore lint/performance/noAwaitInLoops: 并发由 worker 数控制
          const response = await fetch(`/api/eval/classify?index=${index}`);
          const body = await response.json();
          if (body.error && !body.question) {
            throw new Error(body.error);
          }
          results[index] = body;
          setRows([...results]);
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  const done = rows.filter((row): row is Row => row !== null);
  const correct = done.filter((row) => row.ok).length;
  const accuracy = done.length > 0 ? correct / done.length : 0;
  const ms = done.map((row) => row.ms).sort((a, b) => a - b);
  const median = ms.length > 0 ? ms[Math.floor(ms.length / 2)] : 0;

  return (
    <main className="mx-auto max-w-4xl p-8 text-sm">
      <h1 className="mb-2 font-semibold text-xl">快路径归类评测</h1>
      <p className="mb-4 text-muted-foreground">
        20 条手写学生提问，看归类器能不能找到对应的知识点。目标准确率 ≥ 85%。
      </p>
      <button
        className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50"
        disabled={running}
        onClick={run}
        type="button"
      >
        {running ? "跑着呢…" : "开始评测"}
      </button>
      {error ? <p className="mt-3 text-destructive">{error}</p> : null}
      {done.length > 0 ? (
        <p className="mt-4 font-medium text-base" data-testid="accuracy">
          准确率 {correct}/{done.length} = {(accuracy * 100).toFixed(0)}%
          {done.length === rows.length
            ? accuracy >= 0.85
              ? " ✓ 达标"
              : " ✗ 未达标"
            : ""}
          <span className="ml-3 font-normal text-muted-foreground text-sm">
            单次归类中位耗时 {(median / 1000).toFixed(1)} 秒
          </span>
        </p>
      ) : null}
      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1 pr-2">#</th>
            <th className="py-1 pr-2">提问</th>
            <th className="py-1 pr-2">应归到</th>
            <th className="py-1 pr-2">实际归到</th>
            <th className="py-1">耗时</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              className={`border-b align-top ${row && !row.ok ? "bg-red-50 dark:bg-red-950/30" : ""}`}
              // biome-ignore lint/suspicious/noArrayIndexKey: 评测集顺序固定
              key={index}
            >
              <td className="py-1 pr-2">{index + 1}</td>
              <td className="py-1 pr-2">{row?.question ?? "…"}</td>
              <td className="py-1 pr-2">
                {row ? (row.accept?.join(" / ") ?? "（无关）") : ""}
              </td>
              <td className="py-1 pr-2">
                {row ? `${row.ok ? "✓" : "✗"} ${row.got ?? "none"}` : ""}
                {row?.error ? (
                  <div className="text-destructive">{row.error}</div>
                ) : null}
              </td>
              <td className="py-1">
                {row ? `${(row.ms / 1000).toFixed(1)}s` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
