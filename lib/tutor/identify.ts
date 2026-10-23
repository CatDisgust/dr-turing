import "server-only";
import { z } from "zod";
import { askJson } from "@/lib/graph/ask";
import type { IdentityQuestion } from "@/lib/learner/personal";

// 认人（个人知识库·概念身份表）：复盘提到的每个概念，代码先按字面找出像的候选，
// 这里让 Claude（快路径）判断它到底是哪个已有的，还是新的。只在有候选时调用

const answerSchema = z.object({
  answers: z.array(z.object({ index: z.number(), match: z.string() })),
});

const SYSTEM = [
  "你是 Dr.Turing 的概念认人员。学生在对话里提到了一些概念，每个都附了几个名字相近的候选。",
  "判断它和哪个候选是同一个东西：只是换了叫法、加了注释、中英文不同、大小写不同，都算同一个；",
  "意思不同的（比如“乐观锁”和“悲观锁”、“Agent”和“Agent harness”）不算。",
  "match 填候选的 id（包括 #数字 这种，表示这次复盘里前面提到的那条）；都不是就填 new。拿不准填 new。",
  "每条都要答。",
].join("\n");

export async function identify(
  questions: readonly IdentityQuestion[]
): Promise<Map<number, string>> {
  if (questions.length === 0) {
    return new Map();
  }
  const text = questions
    .map((q) =>
      [
        `第 ${q.index} 条：「${q.name}」：${q.definition}（学生原话：${q.quote}）`,
        ...q.candidates.map(
          (c) =>
            `  - 候选 ${c.id}：${c.names.map((n) => `「${n}」`).join("")}：${c.definition}`
        ),
      ].join("\n")
    )
    .join("\n\n");
  const result = await askJson([{ text, type: "text" }], answerSchema, {
    maxTokens: 2000,
    system: SYSTEM,
    tier: "fast",
  });
  return new Map(result.answers.map((a) => [a.index, a.match]));
}
