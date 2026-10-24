import Anthropic from "@anthropic-ai/sdk";
import { extractFilePoints } from "@/lib/graph/extract";
import { readPageTexts } from "@/lib/graph/pdf";
import { uploadLessonFile } from "@/lib/graph/upload";
import { trialUploadBlock } from "@/lib/graph/upload-guard";
import { validatePoints } from "@/lib/graph/validate";
import { fileBlock } from "@/lib/own-course";
import { auth } from "@/lib/session";
import { chargeTo } from "@/lib/spend";

// 传一个课件 PDF，上传到 Files API，抽知识点，核对页码。
// 一行一个 JSON 往回推进度，免得长时间没响应。
// 管理员加公开课、试用同学传自己的课（第 4 步）都走这里；试用同学先查额度和上限
export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await auth();
  chargeTo(session.user.id);
  const blocked = await trialUploadBlock(session);
  if (blocked) {
    return Response.json({ error: blocked }, { status: 403 });
  }
  const form = await request.formData();
  const file = form.get("file");
  const lessonIndex = Number(form.get("lessonIndex"));
  const lessonTitle = String(form.get("lessonTitle") ?? "");

  if (!(file instanceof File) || !Number.isInteger(lessonIndex)) {
    return Response.json({ error: "要一个 PDF 和课序号" }, { status: 400 });
  }
  const tooBig = session.invite ? fileBlock(file.size) : null;
  if (tooBig) {
    return Response.json({ error: tooBig }, { status: 413 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: object) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      const startedAt = Date.now();

      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // 先数页数：试用同学页数超了就不往 Anthropic 传
        const pageTexts = await readPageTexts(bytes);
        const tooLong = session.invite
          ? fileBlock(bytes.length, pageTexts.length)
          : null;
        if (tooLong) {
          throw new Error(tooLong);
        }
        send({ step: "上传到 Files API" });
        const fileId = await uploadLessonFile(file.name, bytes);

        send({ step: `抽知识点（${pageTexts.length} 页）` });
        const drafts = await extractFilePoints(
          fileId,
          lessonTitle || file.name
        );

        const lesson = { fileId, id: `l${lessonIndex}` };
        const result = validatePoints(drafts, lesson, pageTexts);
        send({
          done: true,
          fileId,
          lesson: {
            fileIds: [fileId],
            id: lesson.id,
            index: lessonIndex,
            title: lessonTitle || file.name,
          },
          ms: Date.now() - startedAt,
          pageCount: pageTexts.length,
          ...result,
        });
      } catch (error) {
        console.error("graph extract error:", error);
        const message =
          error instanceof Anthropic.APIError
            ? `Anthropic ${error.status ?? "网络"}：${error.message}`
            : error instanceof Error
              ? error.message
              : String(error);
        send({ error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
