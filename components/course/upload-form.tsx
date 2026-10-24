"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";
import {
  assembleLessons,
  cachedLesson,
  cacheLesson,
  extractLesson,
  forgetLessons,
  type LessonFile,
  type LessonResult,
  lessonTitleOf,
  sortLessonFiles,
} from "@/lib/graph/build-client";
import { fileBlock, type OWN_LIMITS } from "@/lib/own-course";

export type UploadDone = {
  courseId: string;
  name: string;
  lessons: number;
  points: number;
};

// 传课件生成一门课的星图。管理页加公开课、学生传自己的课共用这一份（第 4 步，2026-10-24）。
// 给了 limits 就是学生：先在浏览器里挡掉太大、太多的文件，还要勾“有权使用”才能开始
export function CourseUploadForm({
  title,
  hint,
  limits,
  blocked,
  onDone,
  doneNote,
}: {
  title: string;
  hint: string;
  limits?: typeof OWN_LIMITS;
  blocked?: string | null;
  onDone?: (done: UploadDone) => void;
  doneNote: (done: UploadDone) => ReactNode;
}) {
  const [name, setName] = useState("");
  const [lessons, setLessons] = useState<LessonFile[]>([]);
  const [steps, setSteps] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<UploadDone | null>(null);
  const [agreed, setAgreed] = useState(false);
  // 断了能续：已经抽好的课（按第几课，从 0 数）和没抽成的课的原因
  const results = useRef<Map<number, LessonResult>>(new Map());
  const [got, setGot] = useState(0);
  const [failed, setFailed] = useState<Record<number, string>>({});

  const keep = useCallback((index: number, result: LessonResult | null) => {
    if (result) {
      results.current.set(index, result);
    } else {
      results.current.delete(index);
    }
    setGot(results.current.size);
  }, []);

  const onName = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value),
    []
  );

  const onAgree = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setAgreed(event.target.checked),
    []
  );

  const onFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = sortLessonFiles([...(event.target.files ?? [])]);
      results.current = new Map();
      setGot(0);
      setFailed({});
      setSteps({});
      setDone(null);
      setError(null);
      if (limits) {
        const tooBig = files
          .map((file) => ({ block: fileBlock(file.size), file }))
          .find(({ block }) => block);
        if (files.length > limits.lessons) {
          setError(
            `一门课最多 ${limits.lessons} 课，你选了 ${files.length} 个文件。`
          );
          setLessons([]);
          return;
        }
        if (tooBig) {
          setError(`${tooBig.file.name}：${tooBig.block}`);
          setLessons([]);
          return;
        }
      }
      setLessons(files.map((file) => ({ file, title: lessonTitleOf(file) })));
    },
    [limits]
  );

  // 改了课名，这一课要按新课名重抽
  const onTitle = useCallback(
    (index: number, lessonTitle: string) => {
      keep(index, null);
      setLessons((current) =>
        current.map((lesson, i) =>
          i === index ? { ...lesson, title: lessonTitle } : lesson
        )
      );
    },
    [keep]
  );

  const step = useCallback(
    (key: string, text: string) =>
      setSteps((current) => ({ ...current, [key]: text })),
    []
  );

  // 抽一课：这台设备上有抽好的就直接用，不再花钱；失败了记下原因，不影响别的课
  const extractOne = useCallback(
    async (index: number) => {
      const lesson = lessons[index];
      const key = `第 ${index + 1} 课`;
      const cached = cachedLesson(lesson, index + 1);
      if (cached) {
        keep(index, cached);
        step(key, "完成（之前抽好的）");
        return;
      }
      setFailed(({ [index]: _, ...rest }) => rest);
      try {
        const result = await extractLesson(lesson, index + 1, (text) =>
          step(key, text)
        );
        cacheLesson(lesson, index + 1, result);
        keep(index, result);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setFailed((current) => ({ ...current, [index]: message }));
        step(key, "没成功");
      }
    },
    [keep, lessons, step]
  );

  const retry = useCallback(
    async (index: number) => {
      setError(null);
      setRunning(true);
      await extractOne(index);
      setRunning(false);
    },
    [extractOne]
  );

  const start = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setError(null);
      setDone(null);
      setRunning(true);
      // 只跑还没抽好的课，几课一起跑
      const missing = lessons
        .map((_, i) => i)
        .filter((i) => !results.current.has(i));
      await Promise.all(missing.map((i) => extractOne(i)));
      const left = lessons.length - results.current.size;
      if (left > 0) {
        setError(
          `有 ${left} 课没抽成，点那一课后面的「重试」，或者再点「继续生成」。抽好的课不会重跑。`
        );
        setRunning(false);
        return;
      }
      try {
        const assemble = await assembleLessons({
          name: name.trim(),
          onStep: (text) => step("合图", text),
          results: lessons.map(
            (_, i) => results.current.get(i) as LessonResult
          ),
        });
        if (!assemble.saved) {
          throw new Error("星图生成了，但没存进数据库，看一下 Vercel 日志");
        }
        const result = {
          courseId: assemble.graph.courseId,
          lessons: assemble.graph.lessons.length,
          name: assemble.graph.name,
          points: assemble.graph.points.length,
        };
        forgetLessons(lessons);
        results.current = new Map();
        setGot(0);
        setSteps({});
        setDone(result);
        setName("");
        setLessons([]);
        setAgreed(false);
        onDone?.(result);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(
          `合成星图没成功：${message}。各课都抽好了，再点「继续生成」只重做这一步。`
        );
        step("合图", "没成功");
      }
      setRunning(false);
    },
    [extractOne, lessons, name, onDone, step]
  );

  const locked = running || Boolean(blocked);
  const ready =
    !locked && name.trim() && lessons.length > 0 && (agreed || !limits);

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border-2 p-4"
      data-testid="course-form"
      onSubmit={start}
    >
      <h3 className="font-bold text-[15px]">{title}</h3>
      {blocked ? (
        <p
          className="text-[14px] text-[var(--duo-red-ink)]"
          data-testid="course-blocked"
        >
          {blocked}
        </p>
      ) : null}
      <input
        className="dt-input h-10 px-3"
        data-testid="course-name"
        disabled={locked}
        onChange={onName}
        placeholder="课名，比如 COMP5349 Cloud Computing"
        value={name}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label
          className={`dt-btn ${locked ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
        >
          选课件 PDF
          <input
            accept="application/pdf"
            className="hidden"
            data-testid="course-files"
            disabled={locked}
            multiple
            onChange={onFiles}
            type="file"
          />
        </label>
        <span className="text-[13px] text-muted-foreground">{hint}</span>
      </div>

      {lessons.length > 0 ? (
        <ol className="flex flex-col gap-2" data-testid="course-lessons">
          {lessons.map((lesson, i) => (
            <LessonLine
              failed={failed[i]}
              index={i}
              key={lesson.file.name}
              lesson={lesson}
              onRetry={retry}
              onTitle={onTitle}
              running={running}
              step={steps[`第 ${i + 1} 课`]}
            />
          ))}
          {steps.合图 ? (
            <li className="text-[14px] text-muted-foreground">
              合成一张星图：{steps.合图}
            </li>
          ) : null}
        </ol>
      ) : null}

      {limits ? (
        <label className="flex items-start gap-2 text-[14px]">
          <input
            checked={agreed}
            className="mt-1"
            data-testid="course-consent"
            disabled={locked}
            onChange={onAgree}
            type="checkbox"
          />
          <span>
            这些课件我有权用于自己学习。课件会发给 Anthropic
            生成星图，只有你自己能看到这门课。
          </span>
        </label>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          className="dt-btn dt-btn-primary w-fit"
          data-testid="course-start"
          disabled={!ready}
          type="submit"
        >
          {running ? "生成中…" : got > 0 ? "继续生成" : "生成星图"}
        </button>
        {running ? (
          <span className="text-[13px] text-muted-foreground">
            每课大约 1 分钟，几课一起跑。别关这页。
          </span>
        ) : null}
      </div>
      {error ? (
        <p
          className="text-[14px] text-[var(--duo-red-ink)]"
          data-testid="course-error"
        >
          没加成：{error}
        </p>
      ) : null}
      {done ? (
        <div className="text-[14px]" data-testid="course-done">
          {doneNote(done)}
        </div>
      ) : null}
    </form>
  );
}

function LessonLine({
  index,
  lesson,
  step,
  failed,
  running,
  onTitle,
  onRetry,
}: {
  index: number;
  lesson: LessonFile;
  step?: string;
  failed?: string;
  running: boolean;
  onTitle: (index: number, title: string) => void;
  onRetry: (index: number) => void;
}) {
  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onTitle(index, event.target.value),
    [index, onTitle]
  );
  const retry = useCallback(() => onRetry(index), [index, onRetry]);
  return (
    <li className="flex flex-wrap items-center gap-2 text-[14px]">
      <span className="w-12 shrink-0 text-muted-foreground">
        第 {index + 1} 课
      </span>
      <input
        aria-label={`第 ${index + 1} 课的课名`}
        className="dt-input h-8 min-w-0 flex-1 px-2 text-[14px]"
        disabled={running}
        onChange={onChange}
        value={lesson.title}
      />
      <span
        className="w-40 shrink-0 truncate text-muted-foreground"
        data-testid={`lesson-step-${index + 1}`}
      >
        {step ?? ""}
      </span>
      {failed ? (
        <span className="flex w-full items-center gap-2 pl-14 text-[13px] text-[var(--duo-red-ink)]">
          <span className="min-w-0 flex-1">{failed}</span>
          <button
            className="dt-text-btn shrink-0"
            data-testid={`lesson-retry-${index + 1}`}
            disabled={running}
            onClick={retry}
            type="button"
          >
            重试这一课
          </button>
        </span>
      ) : null}
    </li>
  );
}
