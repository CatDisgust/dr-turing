// Demo 没有登录，顶栏切换学生（D11）。演示学生走画面一、二；A、B 是画面三的预置学生
export const STUDENTS = [
  { id: "00000000-0000-4000-8000-000000000001", key: "demo", name: "演示学生" },
  { id: "00000000-0000-4000-8000-000000000002", key: "a", name: "学生 A" },
  { id: "00000000-0000-4000-8000-000000000003", key: "b", name: "学生 B" },
] as const;

export type StudentKey = (typeof STUDENTS)[number]["key"];

export const STUDENT_COOKIE = "dr-student";

export function studentByKey(key: string | undefined) {
  return STUDENTS.find((s) => s.key === key) ?? STUDENTS[0];
}
