import { addFeedback } from "@/lib/db/queries";
import { auth } from "@/lib/session";

const MAX = 2000;

// 试用同学点「反馈」写一句话，管理页里看
export async function POST(request: Request) {
  const session = await auth();
  const body = (await request.json().catch(() => ({}))) as {
    text?: string;
    page?: string;
  };
  const text = (body.text ?? "").trim().slice(0, MAX);
  if (!text) {
    return Response.json({ error: "写点什么再发" }, { status: 400 });
  }
  await addFeedback({
    page: body.page?.slice(0, 200),
    text,
    userId: session.user.id,
  });
  return Response.json({ ok: true });
}
