import { getCourseById, saveCourse } from "@/lib/db/queries";
import { applyReview, reviewOpSchema } from "@/lib/graph/review";

// 读一门课的图谱；POST 一个审阅操作（合并 / 改名 / 删除），存库后返回新图
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const course = await getCourseById({ id });
  if (!course) {
    return Response.json({ error: "这门课还没生成图谱" }, { status: 404 });
  }
  return Response.json({ graph: course.graph });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const op = reviewOpSchema.safeParse(await request.json().catch(() => null));
  if (!op.success) {
    return Response.json({ error: "操作格式不对" }, { status: 400 });
  }
  const course = await getCourseById({ id });
  if (!course) {
    return Response.json({ error: "这门课还没生成图谱" }, { status: 404 });
  }

  try {
    const graph = applyReview(course.graph, op.data);
    await saveCourse({ files: course.files, graph });
    return Response.json({ graph });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
