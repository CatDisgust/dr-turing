import "server-only";
import { z } from "zod";
import { askJson } from "@/lib/graph/ask";
import type {
  ConceptChange,
  CourseGraph,
  LearnerState,
  PersonalGraph,
  ReviewVerdict,
} from "@/lib/types";

// 慢路径复核（会后跑一次，high）：通读整段对话，逐条确认或推翻快路径批改的暂定结论，
// 再找出导师没被要求就把答案说出来的轮次。只给结论和理由，数由引擎重算

const reviewSchema = z.object({
  concepts: z.array(
    z.object({
      definition: z.string(),
      level: z.enum(["touched", "claimed"]),
      name: z.string(),
      op: z.enum(["add", "update", "invalidate"]),
      quote: z.string(),
      reason: z.string(),
      sameAs: z.string(),
    })
  ),
  leakedMessageIds: z.array(z.string()),
  verdicts: z.array(
    z.object({
      attemptId: z.string(),
      reason: z.string(),
      verdict: z.enum(["confirm", "retract", "flip"]),
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
  "- retract：这条根本不算一次作答，比如学生其实在问别的、只是照抄了导师刚说的话、答案是导师前一句已经说出来的。",
  "- flip：确实是在作答，但对错判反了：把对的判成了错，或把错的判成了对。",
  "  retract 和 flip 的 reason 都用一句中文写清楚原因，引用对话原话。",
  "拿不准就 confirm。每条证据都要给结论。",
  "",
  "二、找答案泄漏：导师在学生作答之前、学生也没要求的情况下，自己把题目的答案说了出来。把这些助手消息的 id 放进 leakedMessageIds；没有就给空数组。",
  "",
  "三、更新学生的个人图谱（只管课外概念）。找出学生在这次对话里自己提到、问到或说自己学过的概念，它们对不上下面给的任何课程知识点。",
  "- 对得上课程知识点的不要列：课内的掌握只认答题证据。",
  "- 对得上已有课外概念的（同一个东西换了个说法也算），op 填 update，sameAs 填它的 id。",
  "- 全新的，op 填 add，sameAs 留空。粒度和课程知识点相当：一个术语或一个具体概念，不要整门学科。",
  "- 对话表明之前记下的课外概念记错了（比如学生说其实没学过），op 填 invalidate，sameAs 填它的 id，reason 写原因。",
  "- level：学生说自己学过、会用，填 claimed；只是提到或问到，填 touched。",
  "- quote 是学生的原话；definition 用一句中文写清楚这个概念。",
  "- 只记学生说的，导师自己提到的不算。没有就给空数组。宁缺毋滥。",
].join("\n");

export async function reviewSession(input: {
  graph: CourseGraph;
  state: LearnerState;
  sessionId: string;
  transcript: TranscriptLine[];
  personal: PersonalGraph;
}): Promise<{
  verdicts: ReviewVerdict[];
  leaks: number;
  concepts: ConceptChange[];
}> {
  const { graph, state, sessionId } = input;
  const evidence: string[] = [];
  for (const [kpId, node] of Object.entries(state.nodes)) {
    const point = graph.points.find((p) => p.id === kpId);
    for (const a of node.attempts) {
      if (!a.provisional || a.sessionId !== sessionId) {
        continue;
      }
      evidence.push(
        [
          `- 证据 ${a.id}｜知识点「${point?.name ?? kpId}」｜学生消息 ${a.turnId}`,
          `  学生原话：${a.quote}`,
          `  快速批改：${a.correct ? "答对" : "答错"}；${a.hinted ? "答之前要过提示或答案" : "没要提示"}；${a.producedStep ? "自己说出了推理" : "没有自己的推理"}${a.misconception ? `；提出的错误想法「${a.misconception}」` : ""}`,
        ].join("\n")
      );
    }
  }
  const assistantIds = new Set(
    input.transcript.filter((l) => l.role === "assistant").map((l) => l.id)
  );
  if (input.transcript.length === 0) {
    return { concepts: [], leaks: 0, verdicts: [] };
  }
  const known = input.personal.concepts.filter(
    (c) => c.status !== "invalidated"
  );

  const text = [
    "整段对话（每条带消息 id）：",
    ...input.transcript.map(
      (l) => `[${l.id}] ${l.role === "user" ? "学生" : "导师"}：${l.text}`
    ),
    "",
    "要复核的暂定证据：",
    ...(evidence.length > 0 ? evidence : ["（无）"]),
    "",
    `课程「${graph.name}」的知识点（这些不算课外概念）：`,
    graph.points.map((p) => p.name).join("、"),
    "",
    "学生已有的课外概念：",
    ...(known.length > 0
      ? known.map((c) => `- ${c.id}「${c.name}」：${c.definition}`)
      : ["（无）"]),
  ].join("\n");

  const result = await askJson([{ text, type: "text" }], reviewSchema, {
    maxTokens: 8000,
    system: SYSTEM,
    tier: "review",
  });
  return {
    concepts: result.concepts,
    leaks: new Set(result.leakedMessageIds.filter((id) => assistantIds.has(id)))
      .size,
    verdicts: result.verdicts,
  };
}
