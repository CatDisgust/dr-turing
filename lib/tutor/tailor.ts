import "server-only";
import { z } from "zod";
import { askJson } from "@/lib/graph/ask";
import type { KnowledgePoint, PendingQuestion } from "@/lib/types";

// 学生自己提了个新问题、规则又定了这一轮只出题时，把题库里那道题改写到他问的情境里
// （2026-10-24 用户定：导师先接住学生的问题，再出贴着这个问题的题）。
// 考的东西不变，只换情境；学生问的就是这个点本身、或者一改就考成别的，就用原题

const tailorSchema = z.object({
  question: z.string(),
  tailored: z.boolean(),
});

const KIND: Record<PendingQuestion["kind"], string> = {
  check: "检查题",
  review: "复习题（隔了一段时间，看他还会不会）",
  variant: "变式题（换个情境用起来）",
};

export async function tailorQuestion(input: {
  point: Pick<KnowledgePoint, "name" | "definition">;
  kind: PendingQuestion["kind"];
  question: string;
  studentText: string;
}): Promise<string | null> {
  const text = [
    `知识点：${input.point.name}：${input.point.definition}`,
    `系统准备出的${KIND[input.kind]}：${input.question}`,
    `学生刚才自己问的：${input.studentText}`,
    "",
    "学生要是在把这个知识点和另一个情境、例子或概念联系起来（比如课外的经典问题、生活里的场景），就把这道题改写到他问的那个情境里：",
    "- 考的核心不变：答对改写后的题需要的理解，和答对原题一样。",
    "- 题面不要带出答案，要让他自己推；也不要原样重复他的问题。",
    "- 一句话，60 字以内，中文。",
    "学生问的就是这个知识点本身（比如“X 是什么”“X 是怎么发生的”），或者一改写就会考成别的东西：tailored 填 false，question 原样抄回原题。",
  ].join("\n");
  const result = await askJson([{ text, type: "text" }], tailorSchema, {
    maxTokens: 1000,
    tier: "fast",
  });
  const question = result.question.trim();
  return result.tailored && question && question !== input.question
    ? question
    : null;
}

// 写给导师的本轮情况：先接住学生自己的问题，再交给系统出题
export function ownQuestionNote(studentText: string, question?: string) {
  return [
    `学生这一轮自己提了个问题：「${studentText}」。`,
    "他问的如果就是这个知识点本身，正好借这个机会看他自己会不会：不要回答，用一句话请他先自己试试。",
    "他如果是在把这个点和别的情境、例子或概念联系起来，先用一两句话正面回应这层联系（是不是一回事、像在哪里），不要绕开，也不要展开讲。",
    question
      ? `系统接下来会出这道题：「${question}」。你的回应不能替他答出这道题，也不要复述题目。`
      : "",
  ].join("");
}
