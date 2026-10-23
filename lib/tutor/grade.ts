import "server-only";
import { z } from "zod";
import { askJson } from "@/lib/graph/ask";
import type { Grading } from "@/lib/learner/question";
import type { KnowledgePoint } from "@/lib/types";

// 快路径批改：对照这个点的定义和课件原文，判断学生这句话答没答、答对没有。
// 答错时只根据学生这句话提出他的错误想法，不预设、不猜；同一个想法沿用他以前的原文，好归到一起。
// 只打观察标签，不打分；分数由引擎算

const gradeSchema = z.object({
  correct: z.boolean(),
  dontKnow: z.boolean().default(false),
  isAnswer: z.boolean(),
  misconception: z.string(),
  producedStep: z.boolean(),
  sameAs: z.number().int().min(0),
});

export type GradeResult = Grading & { isAnswer: boolean; dontKnow: boolean };

export async function gradeAnswer(
  point: KnowledgePoint,
  question: string,
  answer: string,
  // 这个学生在这个点上还没纠正的错误想法
  known: string[] = []
): Promise<GradeResult> {
  const quotes = point.sources.map((s) => `- 第 ${s.page} 页：${s.quote}`);
  const text = [
    `知识点：${point.name}`,
    `定义：${point.definition}`,
    "课件原文：",
    ...quotes,
    "这个学生以前在这个点上的错误想法：",
    known.length > 0
      ? known.map((m, i) => `${i + 1}. ${m}`).join("\n")
      : "（无）",
    "",
    `导师出的题：${question}`,
    `学生的回复：${answer}`,
    "",
    "判断：",
    "- isAnswer：学生是不是在回答这道题（换话题、问别的都算 false）。",
    "- dontKnow：学生明确说不会、不知道、想不出来（没有给出任何答案）。这种情况 isAnswer 也填 true。",
    "- correct：核心意思对就算对，不要求术语、不要求完整；只有回答到点上才算。",
    "- misconception：答错时，如果学生这句话里能看出一个具体的错误想法，用一句话写出来，例如“只要用了锁就一定会死锁”。只根据学生这句话，不要猜；只是不会、答得太空、或者答对了，填空字符串。",
    "- sameAs：这个错误想法和上面列出的第几条是同一个，就填几；是新的或没有，填 0。",
    "- producedStep：学生有没有自己说出一步推理或一个例子，而不是只给结论或照抄题目。",
  ].join("\n");
  const result = await askJson([{ text, type: "text" }], gradeSchema, {
    maxTokens: 1000,
    tier: "fast",
  });
  // 同一个想法用他以前那句原文，引擎按原文归并
  const same = result.sameAs > 0 ? known[result.sameAs - 1] : undefined;
  // 说“不知道”也是证据：记一次答错，没有错误想法（建模审查第 2 条）。以前不记，越不会 M 越停在先验
  if (result.dontKnow) {
    return {
      correct: false,
      dontKnow: true,
      isAnswer: true,
      misconception: "",
      producedStep: false,
    };
  }
  return {
    correct: result.correct,
    dontKnow: false,
    isAnswer: result.isAnswer,
    misconception: result.correct ? "" : (same ?? result.misconception.trim()),
    producedStep: result.producedStep,
  };
}
