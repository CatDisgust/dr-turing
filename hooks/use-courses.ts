"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { LEARNER_REFRESH_EVENT } from "@/lib/constants";
import type { OWN_LIMITS } from "@/lib/own-course";
import { fetcher } from "@/lib/utils";

// due = 这门课现在有几个点该复习了；mine = 这门是这个同学自己传的
export type CourseOption = {
  id: string;
  name: string;
  lessons: number;
  due: number;
  mine?: boolean;
};

// 试用账号自己传课的情况：block 不为空就是传不了，后面是原因
export type OwnUpload = {
  block: string | null;
  count: number;
  limit: number;
  limits: typeof OWN_LIMITS;
};

type CoursesResponse = { courses: CourseOption[]; own: OwnUpload | null };

// 选课列表（2026-10-24）。所有对话共用一份；学完一次（星图刷新）再重新取，复习数跟着变
function useCoursesData() {
  const { data, mutate } = useSWR<CoursesResponse>(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/courses`,
    fetcher,
    { revalidateOnFocus: false }
  );
  useEffect(() => {
    const refresh = () => mutate();
    window.addEventListener(LEARNER_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(LEARNER_REFRESH_EVENT, refresh);
  }, [mutate]);
  return data;
}

export function useCourses() {
  return useCoursesData()?.courses ?? null;
}

// undefined = 还在取；null = 不是试用账号（管理员在管理页加课）
export function useOwnUpload() {
  const data = useCoursesData();
  return data ? data.own : undefined;
}

// 新对话默认选上次选的课；记在这台设备上。NONE = 上次选了“不选课”
const KEY = "dr-course";
export const NONE = "none";

export function lastPickedCourse(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberCourse(choice: string | null) {
  try {
    window.localStorage.setItem(KEY, choice ?? NONE);
  } catch {
    /* 记不住就每次用默认 */
  }
}
