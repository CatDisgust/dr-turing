"use client";

import { type ChangeEvent, useState } from "react";
import type { PageCheck, ValidationResult } from "@/lib/graph/validate";

type Result = ValidationResult & {
  fileId: string;
  lesson: { id: string; index: number; title: string };
  ms: number;
  pageCount: number;
};

const STATUS_LABEL: Record<PageCheck["status"], string> = {
  fuzzy: "✓ 大致对",
  match: "✓ 对",
  mismatch: "✗ 不在这页",
  "no-text": "? 图片页，人工看",
};

// D2 自测页：上传一课课件，看抽出的知识点和页码核对
export default function GraphExtractPage() {
  const [lessonIndex, setLessonIndex] = useState(1);
  const [lessonTitle, setLessonTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const onLessonIndex = (e: ChangeEvent<HTMLInputElement>) =>
    setLessonIndex(Number(e.target.value));
  const onLessonTitle = (e: ChangeEvent<HTMLInputElement>) =>
    setLessonTitle(e.target.value);
  const onFile = (e: ChangeEvent<HTMLInputElement>) =>
    setFile(e.target.files?.[0] ?? null);

  async function run() {
    if (!file) {
      return;
    }
    setError("");
    setResult(null);
    setStep("开始");
    const form = new FormData();
    form.set("file", file);
    form.set("lessonIndex", String(lessonIndex));
    form.set("lessonTitle", lessonTitle);

    try {
      const response = await fetch("/api/graph/extract", {
        body: form,
        method: "POST",
      });
      if (!response.body) {
        throw new Error(`请求失败（${response.status}）`);
      }
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = "";
      while (true) {
        // biome-ignore lint/performance/noAwaitInLoops: 流只能一段一段顺序读
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.error) {
            setError(event.error);
          } else if (event.done) {
            setResult(event);
          } else {
            setStep(event.step);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setStep("");
  }

  function download() {
    if (!result) {
      return;
    }
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `lesson-${result.lesson.index}.json`;
    link.click();
  }

  const counts = { fuzzy: 0, match: 0, mismatch: 0, "no-text": 0 };
  for (const check of result?.checks ?? []) {
    counts[check.status] += 1;
  }
  const checkable = counts.match + counts.fuzzy + counts.mismatch;
  const withSource = result
    ? result.accepted.length /
      (result.accepted.length + result.rejected.length || 1)
    : 0;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 text-sm md:p-8">
      <h1 className="font-semibold text-xl">课件抽知识点（D2 自测）</h1>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          第几课
          <input
            className="w-20 rounded border bg-background px-2 py-1"
            min={1}
            onChange={onLessonIndex}
            type="number"
            value={lessonIndex}
          />
        </label>
        <label className="flex flex-col gap-1">
          课名（可不填）
          <input
            className="w-64 rounded border bg-background px-2 py-1"
            onChange={onLessonTitle}
            value={lessonTitle}
          />
        </label>
        <input accept="application/pdf" onChange={onFile} type="file" />
        <button
          className="rounded bg-primary px-4 py-1.5 text-primary-foreground disabled:opacity-50"
          disabled={!file || Boolean(step)}
          onClick={run}
          type="button"
        >
          {step ? `${step}…` : "开始"}
        </button>
      </div>

      {error ? <p className="text-red-600">出错了：{error}</p> : null}

      {result ? (
        <>
          <div className="space-y-1 rounded border p-3">
            <p>
              {result.pageCount} 页，收下 {result.accepted.length}{" "}
              个知识点，拒收 {result.rejected.length} 个，用时{" "}
              {(result.ms / 1000).toFixed(0)} 秒。
            </p>
            <p>
              带课和页码：{(withSource * 100).toFixed(0)}%。页码自动核对：
              {checkable > 0
                ? `${counts.match + counts.fuzzy}/${checkable} 对得上`
                : "无可核对"}
              ，另有 {counts["no-text"]} 处在图片页要人工看。
            </p>
            {result.rejected.map((r) => (
              <p className="text-red-600" key={r.name}>
                拒收「{r.name}」：{r.reason}
              </p>
            ))}
            <button
              className="mt-2 rounded border px-3 py-1"
              onClick={download}
              type="button"
            >
              下载 JSON
            </button>
          </div>

          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="p-2">知识点</th>
                <th className="p-2">页</th>
                <th className="p-2">核对</th>
                <th className="p-2">课件原文</th>
              </tr>
            </thead>
            <tbody>
              {result.accepted.map((point) =>
                result.checks
                  .filter((check) => check.pointId === point.id)
                  .map((check, i) => (
                    <tr
                      className="border-b align-top"
                      key={`${check.pointId}-${check.page}-${check.quote}`}
                    >
                      <td className="p-2">
                        {i === 0 && (
                          <>
                            <div className="font-medium">{point.name}</div>
                            <div className="text-muted-foreground">
                              {point.aliases.join(" / ")} · {point.kind}
                            </div>
                            <div className="mt-1">{point.definition}</div>
                          </>
                        )}
                      </td>
                      <td className="p-2">{check.page}</td>
                      <td className="whitespace-nowrap p-2">
                        {STATUS_LABEL[check.status]}
                        {check.foundOn.length > 0 &&
                          `（在第 ${check.foundOn.join("、")} 页）`}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {check.quote}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </>
      ) : null}
    </main>
  );
}
