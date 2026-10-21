import "server-only";
import { toFile } from "@anthropic-ai/sdk";
import { claude } from "@/lib/claude";

// 一课的课件可以是一个或多个文件，每个文件单独上传，拿回 file_id
export async function uploadLessonFile(
  name: string,
  bytes: Uint8Array
): Promise<string> {
  const file = await toFile(bytes, name, { type: "application/pdf" });
  const meta = await claude.files.upload({ file });
  return meta.id;
}
