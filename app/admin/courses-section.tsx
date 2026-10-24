"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CourseUploadForm,
  type UploadDone,
} from "@/components/course/upload-form";

type CourseRow = {
  id: string;
  name: string;
  lessons: number;
  points: number;
  updatedAt: string;
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("zh-CN", {
    day: "numeric",
    month: "numeric",
  });

const addedNote = (done: UploadDone) => (
  <>
    加好了：「{done.name}」{done.lessons} 课，{done.points}{" "}
    个知识点。同学开新对话时就能选了。
  </>
);

// 管理页「课程」（试用第 3 步）：你传课件加一门公开课，所有试用账号开新对话时都能选
export function CoursesSection() {
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/courses");
    if (res.ok) {
      setCourses((await res.json()).courses);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

      <CourseUploadForm
        doneNote={addedNote}
        hint="一个文件算一课，按文件名排顺序。课件只发给 Anthropic 生成星图，不存进代码。"
        onDone={load}
        title="加一门课"
      />
    </section>
  );
}
