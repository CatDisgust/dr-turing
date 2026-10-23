import {
  getCourseById,
  getLearnerState,
  saveLearnerState,
} from "@/lib/db/queries";
import {
  DEMO_STUDENT,
  SHOW_STUDENT,
  seedDemoStudent,
  seedNextDay,
} from "@/lib/demo/seed";
import { nodeLight } from "@/lib/learner/light";

// 演示视频的“第二天”：演示学生（或产品演示学生，student: "show"）的「死锁」换成昨天学过、半亮的样子，今天问到它会出复习题。
// 其他点保持现在的样子；还没有状态就先按预置起点建一份
export async function POST(request: Request) {
  try {
    return await writeNextDay(request);
  } catch (error) {
    console.error("[next-day] 失败", error);
    return Response.json(
      {
        error: `写入失败：${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 }
    );
  }
}

async function writeNextDay(request: Request) {
  const { courseId = "comp5348", student } = (await request
    .json()
    .catch(() => ({}))) as {
    courseId?: string;
    student?: "demo" | "show";
  };
  const studentId = student === "show" ? SHOW_STUDENT.id : DEMO_STUDENT.id;
  const course = await getCourseById({ id: courseId });
  if (!course) {
    return Response.json({ error: `没有这门课：${courseId}` }, { status: 404 });
  }
  const now = new Date();
  const current =
    (await getLearnerState({ courseId, studentId })) ??
    seedDemoStudent(course.graph, courseId, now, studentId);
  const result = seedNextDay(course.graph, current, now);
  if (!result) {
    return Response.json(
      { error: "图谱里找不到「死锁」这个点" },
      { status: 422 }
    );
  }
  await saveLearnerState({ state: result.state });
  const node = result.state.nodes[result.target.id];
  return Response.json({
    light: node ? nodeLight(node).light : "none",
    M: node?.M ?? 0,
    name: result.target.name,
    O: node?.O ?? 0,
  });
}
