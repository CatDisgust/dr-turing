"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/utils";

export type CourseOption = { id: string; name: string; lessons: number };

// 选课列表（2026-10-24）。所有对话共用一份，不随对话重新取
export function useCourses() {
  const { data } = useSWR<{ courses: CourseOption[] }>(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/courses`,
    fetcher,
    { revalidateOnFocus: false }
  );
  return data?.courses ?? null;
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
