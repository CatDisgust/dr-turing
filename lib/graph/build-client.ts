import type { GraphScore } from "@/lib/graph/score";
import type { ValidationResult } from "@/lib/graph/validate";
import type { CourseGraph, Edge, Lesson } from "@/lib/types";

// 浏览器里生成一门课的图谱：每课并行抽知识点（/api/graph/extract），再合成一张图（/api/graph/assemble）。
// /graph 自测页和管理页加课都用这一份

export type LessonResult = ValidationResult & {
  fileId: string;
  lesson: Lesson;
  ms: number;
  pageCount: number;
};

export type AssembleResult = {
  droppedEdges: { edge: Edge; reason: string }[];
  graph: CourseGraph;
  merged: { from: string; into: string }[];
  saved: boolean;
  score: GraphScore | null;
  timings: Record<string, number>;
};

export type BuildRun = {
  lessons: LessonResult[];
  assemble: AssembleResult;
  extractMs: number;
  totalMs: number;
};

// 一课一个文件；title 是课名，默认用文件名
export type LessonFile = { file: File; title: string };

// 读一行一个 JSON 的进度流，返回最后的结果
export async function readProgress<T>(
  response: Response,
  onStep: (step: string) => void
): Promise<T> {
  // 被挡下（超额度、文件太大……）时服务器回一个 {error} 而不是进度流
  if (!(response.ok && response.body)) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `请求失败（${response.status}）`);
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

// 按文件名排课序（第 2 课在第 10 课前面）
export function sortLessonFiles(files: File[]) {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );
}

export const lessonTitleOf = (file: File) => file.name.replace(/\.pdf$/i, "");

// onStep 的 key 是「第 N 课」或「合图」；courseId 不给就由服务器新起一个
export async function buildCourse({
  courseId,
  name,
  lessons,
  onStep,
}: {
  courseId?: string;
  name: string;
  lessons: LessonFile[];
  onStep: (key: string, step: string) => void;
}): Promise<BuildRun> {
  const startedAt = Date.now();
  const results = await Promise.all(
    lessons.map(async ({ file, title }, i) => {
      const key = `第 ${i + 1} 课`;
      const form = new FormData();
      form.set("file", file);
      form.set("lessonIndex", String(i + 1));
      form.set("lessonTitle", title.trim() || lessonTitleOf(file));
      const response = await fetch("/api/graph/extract", {
        body: form,
        method: "POST",
      });
      const result = await readProgress<LessonResult>(response, (step) =>
        onStep(key, step)
      );
      onStep(key, "完成");
      return result;
    })
  );
  const extractMs = Date.now() - startedAt;

  const response = await fetch("/api/graph/assemble", {
    body: JSON.stringify({
      courseId,
      lessons: results.map(({ accepted, lesson }) => ({ accepted, lesson })),
      name,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const assemble = await readProgress<AssembleResult>(response, (step) =>
    onStep("合图", step)
  );
  onStep("合图", "完成");
  return {
    assemble,
    extractMs,
    lessons: results,
    totalMs: Date.now() - startedAt,
  };
}
