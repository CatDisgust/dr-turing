import { claude } from "@/lib/claude";
import { deleteCourse, getCourseById, saveCourse } from "@/lib/db/queries";
import { applyReview, reviewOpSchema } from "@/lib/graph/review";
import { canSeeCourse } from "@/lib/own-course";
import { auth } from "@/lib/session";

// 读一门课的图谱；POST 一个审阅操作（合并 / 改名 / 删除），存库后返回新图；DELETE 学生删自己传的课
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [course, session] = await Promise.all([getCourseById({ id }), auth()]);
  // 别人的私人课当作没有
  if (!(course && canSeeCourse(course, session.user.id))) {
    return Response.json({ error: "这门课还没生成图谱" }, { status: 404 });
  }
  return Response.json({ graph: course.graph });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 改课程图谱只给管理员，试用账号只能读
  if ((await auth()).role === "trial") {
    return Response.json({ error: "只有管理员能改图谱" }, { status: 403 });
  }
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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [course, session] = await Promise.all([getCourseById({ id }), auth()]);
  // 只能删自己传的课；公开课和别人的课当作没有
  if (!course || course.ownerId !== session.user.id) {
    return Response.json({ error: "没有这门课" }, { status: 404 });
  }
  const files = await deleteCourse(id);
  // 课件也从 Anthropic 删掉；删不掉只记日志，课已经删了
  await Promise.all(
    files.map((fileId) =>
      claude.files.delete(fileId).catch((error) => {
        console.error(`[course] 删课件 ${fileId} 失败`, error);
      })
    )
  );
  return Response.json({ deleted: id, files: files.length });
}
