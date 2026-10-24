"use client";

import { useCallback } from "react";
import { useActiveChat } from "@/hooks/use-active-chat";
import { type CourseOption, useCourses } from "@/hooks/use-courses";

function Choice({
  id,
  label,
  pressed,
  onPick,
}: {
  id: string | null;
  label: string;
  pressed: boolean;
  onPick: (id: string | null) => void;
}) {
  const pick = useCallback(() => onPick(id), [onPick, id]);
  return (
    <button
      aria-pressed={pressed}
      className="dt-btn dt-btn-sm"
      data-testid={`course-${id ?? "none"}`}
      onClick={pick}
      type="button"
    >
      {label}
    </button>
  );
}

const courseLabel = (c: CourseOption) => c.name;

// 新对话先选这次学哪门课，或者不选课随便问（2026-10-24）。发出第一条后就定下了
export function CoursePicker() {
  const courses = useCourses();
  const { courseId, courseReady, pickCourse } = useActiveChat();
  if (!(courses && courseReady)) {
    return null;
  }
  return (
    <div
      className="pointer-events-auto mt-6 flex max-w-[560px] flex-wrap items-center justify-center gap-2"
      data-testid="course-picker"
    >
      <span className="w-full text-center text-[14px] text-muted-foreground">
        这次学哪门课？
      </span>
      {courses.map((c) => (
        <Choice
          id={c.id}
          key={c.id}
          label={courseLabel(c)}
          onPick={pickCourse}
          pressed={courseId === c.id}
        />
      ))}
      <Choice
        id={null}
        label="不选课，随便问"
        onPick={pickCourse}
        pressed={courseId === null}
      />
    </div>
  );
}
