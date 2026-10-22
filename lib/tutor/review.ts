import "server-only";
import { z } from "zod";
import { askJson } from "@/lib/graph/ask";
import { misconceptionText } from "@/lib/learner/question";
import type { CourseGraph, LearnerState, ReviewVerdict } from "@/lib/types";

// 慢路径复核（会后跑一次，high）：通读整段对话，逐条确认或推翻快路径批改的暂定结论，
// 再找出导师没被要求就把答案说出来的轮次。只给结论和理由，数由引擎重算

const reviewSchema = z.object({
  leakedMessageIds: z.array(z.string()),
  verdicts: z.array(
    z.object({
      attemptId: z.string(),
      reason: z.string(),
      verdict: z.enum(["confirm", "retract"]),
    })
  ),
});

export type TranscriptLine = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const SYSTEM = [
  "你是 Dr.Turing 的会后复核员。一次学习会话结束后，你通读整段对话，复核会话中快速批改给出的暂定结论。",
  "",
  "一、逐条复核暂定证据。每条证据是学生对导师一道题的回答，快速批改已经判了对错、有没有提示、像哪个误解。",
  "结合上下文判断这条结论站不站得住：",
  "- confirm：结论成立。",
  "- retract：结论不成立，比如学生其实在问别的、只是照抄了导师刚说的话、答案是导师前一句已经说出来的、或者批改把对的判成错（错的判成对）。",
  "  reason 用一句中文写清楚为什么推翻，引用对话原话。",
  "拿不准就 confirm。每条证据都要给结论。",
  "",
  "二、找答案泄漏：导师在学生作答之前、学生也没要求的情况下，自己把题目的答案说了出来。把这些助手消息的 id 放进 leakedMessageIds；没有就给空数组。",
].join("\n");

export async function reviewSession(input: {
  graph: CourseGraph;
  state: LearnerState;
  sessionId: string;
  transcript: TranscriptLine[];
}): Promise<{ verdicts: ReviewVerdict[]; leaks: number }> {
  const { graph, state, sessionId } = input;
  const evidence: string[] = [];
  for (const [kpId, node] of Object.entries(state.nodes)) {
    const point = graph.points.find((p) => p.id === kpId);
    for (const a of node.attempts) {
      if (!a.provisional || a.sessionId !== sessionId) {
        continue;
      }
      const mis = point ? misconceptionText(point, a.misconceptionId) : null;
      evidence.push(
        [
          `- 证据 ${a.id}｜知识点「${point?.name ?? kpId}」｜学生消息 ${a.turnId}`,
          `  学生原话：${a.quote}`,
          `  快速批改：${a.correct ? "答对" : "答错"}；${a.hinted ? "答之前要过提示或答案" : "没要提示"}；${a.producedStep ? "自己说出了推理" : "没有自己的推理"}${mis ? `；像误解「${mis}」` : ""}`,
        ].join("\n")
      );
    }
  }
  const assistantIds = new Set(
    input.transcript.filter((l) => l.role === "assistant").map((l) => l.id)
  );
  if (evidence.length === 0 && assistantIds.size === 0) {
    return { leaks: 0, verdicts: [] };
  }

  const text = [
    "整段对话（每条带消息 id）：",
    ...input.transcript.map(
      (l) => `[${l.id}] ${l.role === "user" ? "学生" : "导师"}：${l.text}`
    ),
    "",
    "要复核的暂定证据：",
    ...(evidence.length > 0 ? evidence : ["（无）"]),
  ].join("\n");

  const result = await askJson([{ text, type: "text" }], reviewSchema, {
    maxTokens: 8000,
    system: SYSTEM,
    tier: "review",
  });
  return {
    leaks: new Set(result.leakedMessageIds.filter((id) => assistantIds.has(id)))
      .size,
    verdicts: result.verdicts,
  };
}
