import "server-only";
import { z } from "zod";
import { askJson } from "./ask";

// Claude 只填它能从课件里看出来的东西；课和文件由代码填，不让模型猜
export const draftPointSchema = z.object({
  aliases: z.array(z.string()),
  definition: z.string(),
  // SDK 生成 schema 时会把 enum 降成描述，这里收字符串，validate 再归类
  kind: z.string(),
  name: z.string(),
  sources: z.array(z.object({ page: z.number().int(), quote: z.string() })),
});

const extractionSchema = z.object({ points: z.array(draftPointSchema) });

export type DraftPoint = z.infer<typeof draftPointSchema>;

const EXTRACT_PROMPT = `你在为一个学习辅导系统整理课程知识点。附件是这节课的课件 PDF。

把这节课教的知识点逐个列出来：
- 一个知识点是学生能被单独检查“懂没懂”的一件事。不要把整节课当一个点，也不要把一页上的每个小标题都拆成点。一节课通常 10 到 25 个。
- 跳过行政内容：致谢、版权声明、课程安排、考核、答疑、下周预告、参考书目。
- name：中文名，简短，用学生会搜的叫法。aliases：课件里的英文原词和其他常见叫法。
- definition：用中文一两句话讲清它是什么，只依据课件，不要补课件外的内容。
- kind：memory（要记住的事实、名词）、procedure（步骤、做法）、concept（要理解的原理）、design（要会权衡取舍的设计问题）。
- sources：这个知识点在课件里出现的页，每页一条。page 是 PDF 的页序号，从 1 开始数（这份课件页脚的 “Page N” 一般就等于页序号）。quote 从那一页原样摘一句英文原文，不要改写、不要翻译，方便人回去对。图里的文字也可以摘。至少一条。`;

// 一次只看一个文件，页码才不会混；一课多个文件就调多次，再由 match 去重
export async function extractFilePoints(
  fileId: string,
  lessonTitle: string
): Promise<DraftPoint[]> {
  const { points } = await askJson(
    [
      { source: { file_id: fileId, type: "file" }, type: "document" },
      { text: `这节课：${lessonTitle}\n\n${EXTRACT_PROMPT}`, type: "text" },
    ],
    extractionSchema
  );
  return points;
}
