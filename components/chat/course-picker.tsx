"use client";

import { useCallback } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useCourses } from "@/hooks/use-courses";

// 新对话的问候语下面说一句这次学哪门课。选课在左边侧边栏（课程当文件夹，2026-10-24）；
// 侧边栏收着或在手机上时，点「换一门」把它拉出来
export function CoursePicker() {
  const courses = useCourses();
  const { courseId, courseReady } = useActiveChat();
  const { isMobile, setOpen, setOpenMobile } = useSidebar();
  const openSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(true);
    } else {
      setOpen(true);
    }
  }, [isMobile, setOpen, setOpenMobile]);
  if (!(courses && courseReady)) {
    return null;
  }
  const name = courses.find((c) => c.id === courseId)?.name;
  return (
    <div
      className="pointer-events-auto mt-5 flex items-center gap-2 text-[14px] text-muted-foreground"
      data-testid="course-line"
    >
      <span data-testid="course-current">
        {name ? (
          <>
            在学：<span className="font-semibold text-foreground">{name}</span>
          </>
        ) : (
          "这次不选课，随便问"
        )}
      </span>
      <span aria-hidden>·</span>
      <button
        className="dt-text-btn"
        data-testid="course-switch"
        onClick={openSidebar}
        type="button"
      >
        换一门
      </button>
    </div>
  );
}
