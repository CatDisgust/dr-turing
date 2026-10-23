import { getConceptEvents } from "@/lib/db/queries";
import { splitDraft } from "@/lib/learner/personal";
import { auth } from "@/lib/session";
import { appendPersonal } from "@/lib/tutor/personal-store";

// 合错了：撤销这次合并，两个概念分回去，证据一条不丢
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ mergeId: string }> }
) {
  const { mergeId } = await params;
  const session = await auth();
  const events = await getConceptEvents({ studentId: session.user.id });
  const merge = events.find((e) => e.id === mergeId && e.type === "merge");
  if (!merge) {
    return Response.json({ error: "没有这次合并" }, { status: 404 });
  }
  await appendPersonal(session.user.id, null, [splitDraft(merge)]);
  return Response.json({ ok: true });
}
