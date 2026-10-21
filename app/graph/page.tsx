"use client";

import { type ChangeEvent, useState } from "react";
import type { GraphScore } from "@/lib/graph/score";
import type { ValidationResult } from "@/lib/graph/validate";
import type { CourseGraph, Edge, Lesson } from "@/lib/types";

type LessonResult = ValidationResult & {
  fileId: string;
  lesson: Lesson;
  ms: number;
  pageCount: number;
};

type AssembleResult = {
  droppedEdges: { edge: Edge; reason: string }[];
  graph: CourseGraph;
  merged: { from: string; into: string }[];
  saved: boolean;
  score: GraphScore | null;
  timings: Record<string, number>;
};

type Run = {
  lessons: LessonResult[];
  assemble: AssembleResult;
  extractMs: number;
  totalMs: number;
};

const EDGE_LABEL: Record<Edge["type"], string> = {
  confusable: "易混",
  part_of: "属于",
  prereq: "先修",
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(0)} 秒`;

// 读一行一个 JSON 的进度流，返回最后的结果
async function readProgress<T>(
  response: Response,
  onStep: (step: string) => void
): Promise<T> {
  if (!response.body) {
    throw new Error(`请求失败（${response.status}）`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
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
        throw new Error(event.error);
      }
      if (event.done) {
        return event as T;
      }
      onStep(event.step);
    }
  }
  throw new Error("连接中断，没有拿到结果");
}

// D2/D3 自测页：选一门课的课件（一个文件一课，按文件名排序定课序），
// 每课并行抽知识点，再合成一张图、对金标准打分
export default function GraphBuildPage() {
  const [courseId, setCourseId] = useState("comp5348");
  const [courseName, setCourseName] = useState(
    "COMP5348 Enterprise Scale Software Architecture"
  );
  const [files, setFiles] = useState<File[]>([]);
  const [steps, setSteps] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState<Run | null>(null);

  const onCourseId = (e: ChangeEvent<HTMLInputElement>) =>
    setCourseId(e.target.value);
  const onCourseName = (e: ChangeEvent<HTMLInputElement>) =>
    setCourseName(e.target.value);
  const onFiles = (e: ChangeEvent<HTMLInputElement>) =>
    setFiles(
      [...(e.target.files ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      )
    );

  async function start() {
    setError("");
    setRun(null);
    setSteps({});
    setRunning(true);
    const setStep = (key: string) => (step: string) =>
      setSteps((current) => ({ ...current, [key]: step }));
    const startedAt = Date.now();

    try {
      const lessons = await Promise.all(
        files.map(async (file, i) => {
          const form = new FormData();
          form.set("file", file);
          form.set("lessonIndex", String(i + 1));
          form.set("lessonTitle", file.name.replace(/\.pdf$/i, ""));
          const response = await fetch("/api/graph/extract", {
            body: form,
            method: "POST",
          });
          const result = await readProgress<LessonResult>(
            response,
            setStep(`第 ${i + 1} 课`)
          );
          setStep(`第 ${i + 1} 课`)("完成");
          return result;
        })
      );
      const extractMs = Date.now() - startedAt;

      const response = await fetch("/api/graph/assemble", {
        body: JSON.stringify({
          courseId,
          lessons: lessons.map(({ accepted, lesson }) => ({
            accepted,
            lesson,
          })),
          name: courseName,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const assemble = await readProgress<AssembleResult>(
        response,
        setStep("合图")
      );
      setStep("合图")("完成");
      setRun({ assemble, extractMs, lessons, totalMs: Date.now() - startedAt });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setRunning(false);
  }

  function download() {
    if (!run) {
      return;
    }
    const blob = new Blob([JSON.stringify(run, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${courseId}-graph.json`;
    link.click();
  }

  const graph = run?.assemble.graph;
  const score = run?.assemble.score;
  const nameOf = (id: string) =>
    graph?.points.find((p) => p.id === id)?.name ?? id;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 text-sm md:p-8">
      <h1 className="font-semibold text-xl">课件生成知识图谱（自测）</h1>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          课程 id
          <input
            className="w-32 rounded border bg-background px-2 py-1"
            onChange={onCourseId}
            value={courseId}
          />
        </label>
        <label className="flex flex-col gap-1">
          课程名
          <input
            className="w-80 rounded border bg-background px-2 py-1"
            onChange={onCourseName}
            value={courseName}
          />
        </label>
        <label className="flex flex-col gap-1">
          课件（一个文件一课，可多选）
          <input
            accept="application/pdf"
            multiple
            onChange={onFiles}
            type="file"
          />
        </label>
        <button
          className="rounded bg-primary px-4 py-1.5 text-primary-foreground disabled:opacity-50"
          disabled={files.length === 0 || running}
          onClick={start}
          type="button"
        >
          {running ? "生成中…" : "开始"}
        </button>
      </div>

      {files.length > 0 ? (
        <ul className="space-y-1">
          {files.map((file, i) => (
            <li key={file.name}>
              第 {i + 1} 课：{file.name}
              {steps[`第 ${i + 1} 课`] ? `　${steps[`第 ${i + 1} 课`]}` : ""}
            </li>
          ))}
          {steps.合图 ? <li>合成图谱：{steps.合图}</li> : null}
        </ul>
      ) : null}

      {error ? <p className="text-red-600">出错了：{error}</p> : null}

      {run && graph ? (
        <>
          <section className="space-y-1 rounded border p-3">
            <p>
              总耗时 {seconds(run.totalMs)}：各课并行抽取{" "}
              {seconds(run.extractMs)}，合图和连边{" "}
              {seconds(run.totalMs - run.extractMs)}。
              {run.assemble.saved ? "已存库。" : "存库失败，看日志。"}
            </p>
            {run.lessons.map((lesson) => {
              const ok = lesson.checks.filter(
                (c) => c.status === "match" || c.status === "fuzzy"
              ).length;
              return (
                <p key={lesson.lesson.id}>
                  第 {lesson.lesson.index} 课：{lesson.pageCount} 页，
                  {lesson.accepted.length} 个知识点，拒收{" "}
                  {lesson.rejected.length} 个，页码 {ok}/{lesson.checks.length}{" "}
                  对得上，抽取 {seconds(lesson.ms)}
                </p>
              );
            })}
            <p>
              合并后 {graph.points.length} 个节点（合并了{" "}
              {run.assemble.merged.length} 个），{graph.edges.length} 条边
              {run.assemble.droppedEdges.length > 0
                ? `，丢掉 ${run.assemble.droppedEdges.length} 条不合格的边`
                : ""}
              。
            </p>
            {score ? (
              <p className="font-medium">
                金标准覆盖率 {(score.coverage * 100).toFixed(0)}%（
                {score.covered.length}/
                {score.covered.length + score.missing.length}），疑似重复{" "}
                {score.duplicates.length} 对，先修边
                {score.cycles.prereq ? "有环" : "无环"}。
              </p>
            ) : null}
            {score?.missing.map((m) => (
              <p className="text-red-600" key={`${m.lesson}-${m.gold}`}>
                没覆盖：第 {m.lesson} 课「{m.gold}」
              </p>
            ))}
            {score?.duplicates.map(([a, b]) => (
              <p className="text-red-600" key={`${a}-${b}`}>
                疑似重复：「{nameOf(a)}」和「{nameOf(b)}」
              </p>
            ))}
            {run.assemble.merged.map((m) => (
              <p className="text-muted-foreground" key={m.from}>
                已合并：{m.from} → 「{nameOf(m.into)}」
              </p>
            ))}
            <button
              className="mt-2 rounded border px-3 py-1"
              onClick={download}
              type="button"
            >
              下载 JSON
            </button>
          </section>

          {graph.lessons.map((lesson) => (
            <section className="space-y-2" key={lesson.id}>
              <h2 className="font-semibold">
                第 {lesson.index} 课 {lesson.title}
              </h2>
              <ul className="space-y-1">
                {graph.points
                  .filter((p) => p.lessonId === lesson.id)
                  .map((p) => (
                    <li key={p.id}>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {p.aliases.slice(0, 3).join(" / ")} · 页{" "}
                        {p.sources
                          .map((s) =>
                            s.lessonId === lesson.id
                              ? s.page
                              : `${s.lessonId}-${s.page}`
                          )
                          .join(", ")}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          ))}

          <section className="space-y-1">
            <h2 className="font-semibold">关系</h2>
            {graph.edges.map((edge) => (
              <p key={`${edge.type}-${edge.from}-${edge.to}`}>
                {nameOf(edge.from)} → {nameOf(edge.to)}
                <span className="text-muted-foreground">
                  （{EDGE_LABEL[edge.type]}）
                </span>
              </p>
            ))}
          </section>
        </>
      ) : null}
    </main>
  );
}
