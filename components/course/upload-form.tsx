"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useState,
} from "react";
import {
  buildCourse,
  type LessonFile,
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

  const onTitle = useCallback((index: number, lessonTitle: string) => {
    setLessons((current) =>
      current.map((lesson, i) =>
        i === index ? { ...lesson, title: lessonTitle } : lesson
      )
    );
  }, []);

  const start = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setError(null);
      setDone(null);
      setSteps({});
      setRunning(true);
      try {
        const run = await buildCourse({
          lessons,
          name: name.trim(),
          onStep: (key, step) =>
            setSteps((current) => ({ ...current, [key]: step })),
        });
        if (!run.assemble.saved) {
          throw new Error("星图生成了，但没存进数据库，看一下 Vercel 日志");
        }
        const result = {
          courseId: run.assemble.graph.courseId,
          lessons: run.assemble.graph.lessons.length,
          name: run.assemble.graph.name,
          points: run.assemble.graph.points.length,
        };
        setDone(result);
        setName("");
        setLessons([]);
        setAgreed(false);
        onDone?.(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      setRunning(false);
    },
    [lessons, name, onDone]
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
              index={i}
              key={lesson.file.name}
              lesson={lesson}
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
          {running ? "生成中…" : "生成星图"}
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
  running,
  onTitle,
}: {
  index: number;
  lesson: LessonFile;
  step?: string;
  running: boolean;
  onTitle: (index: number, title: string) => void;
}) {
  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onTitle(index, event.target.value),
    [index, onTitle]
  );
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
      <span className="w-40 shrink-0 truncate text-muted-foreground">
        {step ?? ""}
      </span>
    </li>
  );
}
