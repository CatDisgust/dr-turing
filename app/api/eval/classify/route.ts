import evalSet from "@/fixtures/eval/classify-comp5348.json";
import { FAST_MODELS, type FastModel } from "@/lib/claude";
import { COURSE_ID } from "@/lib/constants";
import { getCourseById } from "@/lib/db/queries";
import { classifyQuestion } from "@/lib/tutor/classify";
import { type ClassifyCase, isAccepted } from "@/lib/tutor/classify-eval";

export const maxDuration = 60;

const cases = evalSet.items as ClassifyCase[];

// 跑评测集里的第 index 条：一次一条，页面那边控制并发、显示进度。
// 也可以直接给一句话：?question=…&accept=死锁（录演示视频前，用 scripts/demo-video/classify-check.mjs 查归类稳不稳）
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const index = Number(params.get("index"));
  const question = params.get("question");
  // 页面上选的快路径模型，用来对比 Opus 低档和 Haiku 5.5
  const model = params.get("model");
  const fastModel =
    model && model in FAST_MODELS ? (model as FastModel) : undefined;
  const item: ClassifyCase | undefined = question
    ? { accept: params.get("accept")?.split("|") ?? null, question }
    : cases[index];
  if (!item) {
    return Response.json({ total: cases.length });
  }
  const course = await getCourseById({ id: COURSE_ID });
  if (!course) {
    return Response.json({ error: "这门课还没生成图谱" }, { status: 404 });
  }
  const started = Date.now();
  try {
    const point = await classifyQuestion(
      course.graph,
      item.question,
      fastModel
    );
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
