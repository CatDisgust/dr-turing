"use client";

import { useCallback } from "react";
import {
  CourseUploadForm,
  type UploadDone,
} from "@/components/course/upload-form";
import { rememberCourse, useOwnUpload } from "@/hooks/use-courses";

// 试用同学传自己的课（第 4 步，2026-10-24）：传课件 → 生成只有自己能看到的星图 → 回学习页学
export function MyCourse() {
  const own = useOwnUpload();

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-[20px]">上传我的课</h1>
        <a className="dt-text-btn" href="/">
          回到学习页
        </a>
      </div>
      {own === undefined ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      ) : null}
      {own === null ? (
        <p className="text-[15px]">
          管理员加的课是大家都能学的公开课，请到
          <a className="dt-text-btn" href="/admin">
            管理页
          </a>
          去加。
        </p>
      ) : null}
      {own ? (
        <>
          <ul
            className="flex list-disc flex-col gap-1 pl-5 text-[14px] text-muted-foreground"
            data-testid="own-limits"
          >
            <li>
              你已经有 {own.count} 门自己的课，最多 {own.limit} 门。
            </li>
            <li>
              一个 PDF 算一课，一门课最多 {own.limits.lessons}{" "}
              课；每个文件不超过 {own.limits.fileMb}MB、{own.limits.pages} 页。
            </li>
            <li>
              生成星图会用掉一些试用额度；每个账号最多生成{" "}
              {own.limits.generations} 次，删了再传也算一次。
            </li>
          </ul>
          <CourseUploadForm
            blocked={own.block}
            doneNote={DoneNote}
            hint="一个文件算一课，按文件名排顺序。"
            limits={own.limits}
            title="传课件"
          />
        </>
      ) : null}
    </>
  );
}

function DoneNote(done: UploadDone) {
  return <LearnNow done={done} />;
}

function LearnNow({ done }: { done: UploadDone }) {
  const learn = useCallback(() => {
    rememberCourse(done.courseId);
    // 整页跳回去，侧边栏的课程列表重新取，新课就在里面了
    window.location.href = "/";
  }, [done.courseId]);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span>
        好了：「{done.name}」{done.lessons} 课，{done.points} 个知识点。
      </span>
      <button
        className="dt-btn dt-btn-primary"
        data-testid="course-learn"
        onClick={learn}
        type="button"
      >
        去学这门课
      </button>
    </div>
  );
}
