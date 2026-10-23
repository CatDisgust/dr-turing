import {
  getCourseById,
  resetStudent,
  saveLearnerState,
} from "@/lib/db/queries";
import { SHOW_STUDENT, seedDemoStudent, seedScene2 } from "@/lib/demo/seed";
import { nodeLight } from "@/lib/learner/light";

// 产品演示学生（录演示视频用）清空重来：旧对话、星图、学生模型、作答记录全删，
// 再写成和演示学生一样的预置起点（第 1 课学完、第 2 课学一半、丢失更新昨天半亮）。
// 只动产品演示学生，演示学生留给用户自己测试
export async function POST(request: Request) {
  try {
    return await reset(request);
  } catch (error) {
    console.error("[reset] 失败", error);
    return Response.json(
      {
        error: `重置失败：${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 }
    );
  }
}

async function reset(request: Request) {
  const { courseId = "comp5348" } = (await request
    .json()
    .catch(() => ({}))) as {
    courseId?: string;
  };
  const course = await getCourseById({ id: courseId });
  if (!course) {
    return Response.json({ error: `没有这门课：${courseId}` }, { status: 404 });
  }
  await resetStudent({ studentId: SHOW_STUDENT.id });
  const now = new Date();
  const start = seedDemoStudent(course.graph, courseId, now, SHOW_STUDENT.id);
  const state = seedScene2(course.graph, start, now)?.state ?? start;
  await saveLearnerState({ state });
  const lights = Object.values(state.nodes).map((n) => nodeLight(n).light);
  return Response.json({
    full: lights.filter((l) => l === "full").length,
    half: lights.filter((l) => l === "half").length,
    name: SHOW_STUDENT.name,
  });
}
