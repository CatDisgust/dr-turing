import evalSet from "@/fixtures/eval/classify-comp5348.json";
import { COURSE_ID } from "@/lib/constants";
import { getCourseById } from "@/lib/db/queries";
import { classifyQuestion } from "@/lib/tutor/classify";
import { type ClassifyCase, isAccepted } from "@/lib/tutor/classify-eval";

export const maxDuration = 60;

const cases = evalSet.items as ClassifyCase[];

// 跑评测集里的第 index 条：一次一条，页面那边控制并发、显示进度
export async function GET(request: Request) {
  const index = Number(new URL(request.url).searchParams.get("index"));
  const item = cases[index];
  if (!item) {
    return Response.json({ total: cases.length });
  }
  const course = await getCourseById({ id: COURSE_ID });
  if (!course) {
    return Response.json({ error: "这门课还没生成图谱" }, { status: 404 });
  }
  const started = Date.now();
  try {
    const point = await classifyQuestion(course.graph, item.question);
    return Response.json({
      accept: item.accept,
      got: point ? point.name : null,
      ms: Date.now() - started,
      ok: isAccepted(point, item.accept),
      question: item.question,
      total: cases.length,
    });
  } catch (error) {
    return Response.json({
      accept: item.accept,
      error: error instanceof Error ? error.message : String(error),
      got: null,
      ms: Date.now() - started,
      ok: false,
      question: item.question,
      total: cases.length,
    });
  }
}
