import "server-only";
import { z } from "zod";
import type { FastModel } from "@/lib/claude";
import { askJson } from "@/lib/graph/ask";
import type { CourseGraph, KnowledgePoint } from "@/lib/types";

// 快路径归类：学生这句话在问课里哪个知识点。只挑一个，或者 none。
// 知识点列表每门课固定，放进带缓存的 system，每次只付学生这句话的钱

const classifySchema = z.object({
  kpId: z.string(),
});

export function classifySystem(graph: CourseGraph): string {
  const lessons = new Map(graph.lessons.map((l) => [l.id, l.title]));
  const lines = graph.points.map((p) => {
    const aliases =
      p.aliases.length > 0 ? `（又称 ${p.aliases.join("、")}）` : "";
    return `${p.id} | ${lessons.get(p.lessonId) ?? p.lessonId} | ${p.name}${aliases}：${p.definition}`;
  });
  return [
    `你是课程「${graph.name}」的提问归类器。下面是这门课的全部知识点，每行：id | 所在课 | 名称：定义。`,
    "",
    ...lines,
    "",
    "学生会发来一句提问（可能附带他从课件里划出的原文）。判断这句话主要在问哪一个知识点，只回一个 kpId。",
    "问的是好几个点时，挑最核心、最具体的那个。和这门课无关，或者只是寒暄，就回 none。",
  ].join("\n");
}

export async function classifyQuestion(
  graph: CourseGraph,
  question: string,
  fastModel?: FastModel
): Promise<KnowledgePoint | null> {
  const { kpId } = await askJson(
    [{ text: `学生提问：${question}`, type: "text" }],
    classifySchema,
    {
      fastModel,
      maxTokens: 1000,
      system: classifySystem(graph),
      tier: "fast",
    }
  );
  return graph.points.find((p) => p.id === kpId) ?? null;
}
