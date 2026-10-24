import Anthropic from "@anthropic-ai/sdk";
import { extractFilePoints } from "@/lib/graph/extract";
import { readPageTexts } from "@/lib/graph/pdf";
import { uploadLessonFile } from "@/lib/graph/upload";
import { validatePoints } from "@/lib/graph/validate";
import { auth } from "@/lib/session";
import { chargeTo } from "@/lib/spend";

// D2 自测用：传一个课件 PDF，上传到 Files API，抽知识点，核对页码。
// 一行一个 JSON 往回推进度，免得长时间没响应
export const maxDuration = 300;

export async function POST(request: Request) {
  chargeTo((await auth()).user.id);
  const form = await request.formData();
  const file = form.get("file");
  const lessonIndex = Number(form.get("lessonIndex"));
  const lessonTitle = String(form.get("lessonTitle") ?? "");

  if (!(file instanceof File) || !Number.isInteger(lessonIndex)) {
    return Response.json({ error: "要一个 PDF 和课序号" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: object) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      const startedAt = Date.now();

      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        send({ step: "上传到 Files API" });
        const [fileId, pageTexts] = await Promise.all([
          uploadLessonFile(file.name, bytes),
          readPageTexts(bytes),
        ]);

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
