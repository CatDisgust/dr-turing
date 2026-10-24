"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  buildCourse,
  type LessonFile,
  lessonTitleOf,
  sortLessonFiles,
} from "@/lib/graph/build-client";

type CourseRow = {
  id: string;
  name: string;
  lessons: number;
  points: number;
  updatedAt: string;
};

type Done = { name: string; lessons: number; points: number };

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("zh-CN", {
    day: "numeric",
    month: "numeric",
  });

// 管理页「课程」（试用第 3 步）：你传课件加一门公开课，所有试用账号开新对话时都能选
export function CoursesSection() {
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const [name, setName] = useState("");
  const [lessons, setLessons] = useState<LessonFile[]>([]);
  const [steps, setSteps] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/courses");
    if (res.ok) {
      setCourses((await res.json()).courses);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onName = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value),
    []
  );

  const onFiles = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setLessons(
      sortLessonFiles([...(event.target.files ?? [])]).map((file) => ({
        file,
        title: lessonTitleOf(file),
      }))
    );
    setSteps({});
    setDone(null);
    setError(null);
  }, []);

  const onTitle = useCallback((index: number, title: string) => {
    setLessons((current) =>
      current.map((lesson, i) => (i === index ? { ...lesson, title } : lesson))
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
        setDone({
          lessons: run.assemble.graph.lessons.length,
          name: run.assemble.graph.name,
          points: run.assemble.graph.points.length,
        });
        setName("");
        setLessons([]);
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      setRunning(false);
    },
    [lessons, name, load]
  );

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-bold text-[17px]">
        课程 {courses ? `· ${courses.length} 门` : ""}
      </h2>
      <p className="text-[14px] text-muted-foreground">
        这里的课所有试用账号开新对话时都能选。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[14px]" data-testid="courses">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-normal">课名</th>
              <th className="py-2 pr-3 font-normal">课数</th>
              <th className="py-2 pr-3 font-normal">知识点</th>
              <th className="py-2 pr-3 font-normal">更新</th>
              <th className="py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {courses?.map((row) => (
              <tr className="border-t-2" key={row.id}>
                <td className="py-2 pr-3">{row.name}</td>
                <td className="py-2 pr-3">{row.lessons}</td>
                <td className="py-2 pr-3">{row.points}</td>
                <td className="py-2 pr-3">{day(row.updatedAt)}</td>
                <td className="py-2">
                  <a className="dt-text-btn" href={`/course/${row.id}`}>
                    看星图
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        className="flex flex-col gap-3 rounded-xl border-2 p-4"
        data-testid="course-form"
        onSubmit={start}
      >
        <h3 className="font-bold text-[15px]">加一门课</h3>
        <input
          className="dt-input h-10 px-3"
          data-testid="course-name"
          disabled={running}
          onChange={onName}
          placeholder="课名，比如 COMP5349 Cloud Computing"
          value={name}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label
            className={`dt-btn ${running ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
          >
            选课件 PDF
            <input
              accept="application/pdf"
              className="hidden"
              data-testid="course-files"
              disabled={running}
              multiple
              onChange={onFiles}
              type="file"
            />
          </label>
          <span className="text-[13px] text-muted-foreground">
            一个文件算一课，按文件名排顺序。课件只发给 Anthropic
            生成星图，不存进代码。
          </span>
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

        <div className="flex items-center gap-3">
          <button
            className="dt-btn dt-btn-primary w-fit"
            data-testid="course-start"
            disabled={running || !name.trim() || lessons.length === 0}
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
          <p className="text-[14px] text-[var(--duo-red-ink)]">
            没加成：{error}
          </p>
        ) : null}
        {done ? (
          <p className="text-[14px]" data-testid="course-done">
            加好了：「{done.name}」{done.lessons} 课，{done.points}{" "}
            个知识点。同学开新对话时就能选了。
          </p>
        ) : null}
      </form>
    </section>
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
