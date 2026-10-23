import { getConceptEvents } from "@/lib/db/queries";
import { unlinkDraft } from "@/lib/learner/personal";
import { auth } from "@/lib/session";
import { appendPersonal } from "@/lib/tutor/personal-store";

// 学生说这条关系连错了：记一条撤销进日志（学生给的证据），关系本身不删
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ linkId: string }> }
) {
  const { linkId } = await params;
  const session = await auth();
  const events = await getConceptEvents({ studentId: session.user.id });
  const link = events.find((e) => e.id === linkId && e.type === "link");
  if (!link) {
    return Response.json({ error: "没有这条关系" }, { status: 404 });
  }
  await appendPersonal(session.user.id, null, [unlinkDraft(link)]);
  return Response.json({ ok: true });
}
