import { z } from "zod";
import { getCourseById, getLearnerStatesByStudent } from "@/lib/db/queries";
import { mergeDraft } from "@/lib/learner/personal";
import { auth } from "@/lib/session";
import { appendPersonal, loadPersonal } from "@/lib/tutor/personal-store";

const bodySchema = z.object({ into: z.string() });

// 学生说“这个和那个是同一个”：把 id 并进 into，记成学生给的证据。id 得是他看得到的课外概念；
// into 是另一个课外概念，或他课程里的知识点（锚定：之后只算那个知识点的出处，不动掌握度）
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.into === id) {
    return Response.json({ error: "参数不对" }, { status: 400 });
  }
  const session = await auth();
  const { graph } = await loadPersonal(session.user.id);
  const visible = new Set(
    graph.concepts.filter((c) => c.status === "unanchored").map((c) => c.id)
  );
  const { into } = parsed.data;
  if (
    !(
      visible.has(id) &&
      (visible.has(into) || (await isCoursePoint(session.user.id, into)))
    )
  ) {
    return Response.json({ error: "概念不存在" }, { status: 404 });
  }
  await appendPersonal(session.user.id, null, [mergeDraft(id, into)]);
  return Response.json({ ok: true });
}

async function isCoursePoint(studentId: string, kpId: string) {
  const states = await getLearnerStatesByStudent({ studentId });
  const courses = await Promise.all(
    states.map((s) => getCourseById({ id: s.courseId }))
  );
  return courses.some((c) => c?.graph.points.some((p) => p.id === kpId));
}
