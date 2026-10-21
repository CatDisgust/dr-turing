import "server-only";
import { extractText, getDocumentProxy } from "unpdf";

// 每页的文字，下标 0 是第 1 页；只拿来核对页码，不喂给 Claude
export async function readPageTexts(bytes: Uint8Array): Promise<string[]> {
  // pdf.js 会接管传进去的 buffer，复制一份免得影响上传
  const pdf = await getDocumentProxy(bytes.slice());
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}
