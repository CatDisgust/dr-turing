import { z } from "zod";
import { mergeDraft } from "@/lib/learner/personal";
import { auth } from "@/lib/session";
import { appendPersonal, loadPersonal } from "@/lib/tutor/personal-store";

const bodySchema = z.object({ into: z.string() });

// 学生说“这个和那个是同一个”：把 id 并进 into，记成学生给的证据；两个都得是他现在看得到的课外概念
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
  if (!(visible.has(id) && visible.has(parsed.data.into))) {
    return Response.json({ error: "概念不存在" }, { status: 404 });
  }
  await appendPersonal(session.user.id, null, [
    mergeDraft(id, parsed.data.into),
  ]);
  return Response.json({ ok: true });
}
