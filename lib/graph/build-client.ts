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

// 抽一课的知识点。index 从 1 数
export async function extractLesson(
  { file, title }: LessonFile,
  index: number,
  onStep: (step: string) => void
): Promise<LessonResult> {
  const form = new FormData();
  form.set("file", file);
  form.set("lessonIndex", String(index));
  form.set("lessonTitle", title.trim() || lessonTitleOf(file));
  const response = await fetch("/api/graph/extract", {
    body: form,
    method: "POST",
  });
  const result = await readProgress<LessonResult>(response, onStep);
  onStep("完成");
  return result;
}

// 把抽好的各课合成一张图存库；courseId 不给就由服务器新起一个
export async function assembleLessons({
  courseId,
  name,
  results,
  onStep,
}: {
  courseId?: string;
  name: string;
  results: LessonResult[];
  onStep: (step: string) => void;
}): Promise<AssembleResult> {
  const response = await fetch("/api/graph/assemble", {
    body: JSON.stringify({
      courseId,
      lessons: results.map(({ accepted, lesson }) => ({ accepted, lesson })),
      name,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const assemble = await readProgress<AssembleResult>(response, onStep);
  onStep("完成");
  return assemble;
}

// 断了能续（2026-10-24 评审文档）：抽好的课先记在这台设备上，失败了重试或者关掉页面再来，
// 同一份文件、同一课序、同一课名就不再花钱重抽。整门课存好以后清掉
const CACHE_PREFIX = "dr-lesson:";

const cacheKey = ({ file, title }: LessonFile, index: number) =>
  `${CACHE_PREFIX}${file.name}:${file.size}:${file.lastModified}:${index}:${title.trim()}`;

export function cachedLesson(
  lesson: LessonFile,
  index: number
): LessonResult | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(lesson, index));
    return raw ? (JSON.parse(raw) as LessonResult) : null;
  } catch {
    return null;
  }
}

export function cacheLesson(
  lesson: LessonFile,
  index: number,
  result: LessonResult
) {
  try {
    window.localStorage.setItem(
      cacheKey(lesson, index),
      JSON.stringify(result)
    );
  } catch {
    /* 存不下就算了，大不了重抽 */
  }
}

export function forgetLessons(lessons: LessonFile[]) {
  try {
    for (const [i, lesson] of lessons.entries()) {
      window.localStorage.removeItem(cacheKey(lesson, i + 1));
    }
  } catch {
    /* 清不掉也不影响 */
  }
}

// /graph 自测页用：一次跑完，不续。onStep 的 key 是「第 N 课」或「合图」
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
    lessons.map((lesson, i) =>
      extractLesson(lesson, i + 1, (step) => onStep(`第 ${i + 1} 课`, step))
    )
  );
  const extractMs = Date.now() - startedAt;
  const assemble = await assembleLessons({
    courseId,
    name,
    onStep: (step) => onStep("合图", step),
    results,
  });
  return {
    assemble,
    extractMs,
    lessons: results,
    totalMs: Date.now() - startedAt,
  };
}
