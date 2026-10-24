import { listCourses } from "@/lib/db/queries";

// 开新对话时选课用：现在所有课大家都能选（第 3、4 步再分公开课和自己的课）
export async function GET() {
  return Response.json({ courses: await listCourses() });
}
