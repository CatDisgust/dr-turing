import { getCourseById, saveLearnerState } from "@/lib/db/queries";
import { seedStudents, seedSummary } from "@/lib/demo/seed";

// 写入画面三的预置学生 A、B（覆盖他们在这门课上的状态，演示学生不动）
export async function POST(request: Request) {
  try {
    return await writeSeed(request);
  } catch (error) {
    console.error("[seed] 失败", error);
    return Response.json(
      {
        error: `写入失败：${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 }
    );
  }
}

async function writeSeed(request: Request) {
  const { courseId = "comp5348" } = (await request
    .json()
    .catch(() => ({}))) as {
    courseId?: string;
  };
  const course = await getCourseById({ id: courseId });
  if (!course) {
    return Response.json({ error: `没有这门课：${courseId}` }, { status: 404 });
  }
  const seed = seedStudents(course.graph, courseId, new Date());
  if (!seed) {
    return Response.json(
      { error: "图谱里找不到「悲观并发控制（加锁）」这个点" },
      { status: 422 }
    );
  }
  await saveLearnerState({ state: seed.a });
  await saveLearnerState({ state: seed.b });
  return Response.json({
    misconception: seed.misconception ?? null,
    prereqs: seedSummary(seed),
    target: { id: seed.target.id, name: seed.target.name },
  });
}
