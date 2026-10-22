import "server-only";
import { z } from "zod";
import { askJson } from "@/lib/graph/ask";
import type { Grading } from "@/lib/learner/question";
import type { KnowledgePoint } from "@/lib/types";

// 快路径批改：对照这个点的定义、课件原文和已知误解，判断学生这句话答没答、答对没有。
// 只打观察标签，不打分；分数由引擎算

const gradeSchema = z.object({
  correct: z.boolean(),
  isAnswer: z.boolean(),
  misconception: z.number().int().min(0),
  producedStep: z.boolean(),
});

export type GradeResult = Grading & { isAnswer: boolean };

export async function gradeAnswer(
  point: KnowledgePoint,
  question: string,
  answer: string
): Promise<GradeResult> {
  const misconceptions = point.misconceptions
    .map((m, i) => `${i + 1}. ${m}`)
    .join("\n");
  const quotes = point.sources.map((s) => `- 第 ${s.page} 页：${s.quote}`);
  const text = [
    `知识点：${point.name}`,
    `定义：${point.definition}`,
    "课件原文：",
    ...quotes,
    "常见误解：",
    misconceptions || "（无）",
    "",
    `导师出的题：${question}`,
    `学生的回复：${answer}`,
    "",
    "判断：",
    "- isAnswer：学生是不是在回答这道题（换话题、问别的、只说“不知道”都算 false）。",
    "- correct：核心意思对就算对，不要求术语、不要求完整；只有回答到点上才算。",
    "- misconception：错法像上面第几个常见误解，就填几；都不像或答对了填 0。",
    "- producedStep：学生有没有自己说出一步推理或一个例子，而不是只给结论或照抄题目。",
  ].join("\n");
  const result = await askJson([{ text, type: "text" }], gradeSchema, {
    maxTokens: 1000,
    tier: "fast",
  });
  return {
    ...result,
    misconception:
      result.misconception <= point.misconceptions.length
        ? result.misconception
        : 0,
  };
}
