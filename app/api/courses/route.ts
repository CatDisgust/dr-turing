import { listCourses } from "@/lib/db/queries";

// 开新对话时选课用：管理员在管理页加的课大家都能选（第 4 步再加学生自己的课）
export async function GET() {
  return Response.json({ courses: await listCourses() });
}
