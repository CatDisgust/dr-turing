import "server-only";
import { z } from "zod";
import { askJson } from "@/lib/graph/ask";
import {
  activeNotes,
  MAX_NOTES,
  type Miss,
  missId,
  type NoteOp,
} from "@/lib/learner/notes";
import type { CourseGraph, TeachingNote } from "@/lib/types";
import type { TranscriptLine } from "./review";

// 教学笔记的写法（学生建模方案 E）：复核时只在猜错过的会话里调一次（high），
// 输入猜错的预测、相关原话和现有笔记，输出增删改，每个操作都要引用证据 id。
// 检验和自动删除都由代码做（lib/learner/notes.ts）

const opSchema = z.object({
  evidence: z.array(z.string()),
  expect: z.enum(["learn_good", "learn_bad", "feel_good", "feel_bad"]),
  id: z.string(),
  kind: z.enum(["memory", "procedure", "concept", "design", "any"]),
  op: z.enum(["add", "edit", "delete"]),
  order: z.enum(["example_first", "definition_first", "any"]),
  representation: z.enum(["analogy", "code", "formula", "diagram", "any"]),
  text: z.string(),
});

const notesSchema = z.object({ ops: z.array(opSchema) });

const REPRESENTATION = {
  analogy: "生活类比",
  code: "代码",
  diagram: "图示",
  formula: "公式",
} as const;
const ORDER = { definition_first: "先定义", example_first: "先例子" } as const;

const SYSTEM = [
  "你是 Dr.Turing 的教学笔记员。系统每次讲解前都会猜两件事：学生接下来能不能独立答对，以及他对这种讲法舒不舒服。下面是同一种讲法下累计猜错的几次，可能跨了几次学习；对话原文只给了这一次的。",
  "你的任务：从猜错的地方找出关于这个学生“怎么讲对他更有效”的规律，写成可以检验的笔记，或者修改、删除已有笔记。",
  "",
  "每条笔记：",
  "- text：一句中文，写清楚规律，比如“他要先看例子才能接受定义”。",
  "- representation / order / kind：这条规律在什么讲法下成立。representation 是表征（analogy 类比、code 代码、formula 公式、diagram 图示），order 是先例子还是先定义，kind 是知识点类型。不限就填 any。",
  "- expect：在这种讲法下预计会怎样。learn_good 学得会、learn_bad 学不会、feel_good 他觉得舒服、feel_bad 他觉得难受。",
  "- evidence：支持这条的证据 id，只能从下面给出的 id 里选，至少一个。",
  "",
  "操作：add 新增（id 留空）；edit 改写一条已有笔记（id 填它的 id，改写后从零重新检验）；delete 删除一条已有笔记（id 填它的 id，证据填推翻它的那条）。",
  `有效笔记最多 ${MAX_NOTES} 条。只写有证据撑着的规律，一次猜错可能只是偶然，宁缺毋滥；没有值得写的就给空数组。`,
  "笔记只关于怎么讲，不要写他会不会某个知识点。",
].join("\n");

const any = <T extends string>(v: T | "any") => (v === "any" ? undefined : v);

export async function writeNotes(input: {
  graph: CourseGraph;
  misses: Miss[];
  notes: readonly TeachingNote[];
  transcript: TranscriptLine[];
}): Promise<{ ops: NoteOp[]; evidenceIds: Set<string> }> {
  const nameOf = (kpId: string) => {
    const p = input.graph.points.find((x) => x.id === kpId);
    return p ? `「${p.name}」（${p.kind}）` : kpId;
  };
  const armName = (arm: string) => {
    const [r, o] = arm.split(":") as [
      keyof typeof REPRESENTATION,
      keyof typeof ORDER,
    ];
    return `${REPRESENTATION[r] ?? r}、${ORDER[o] ?? o}`;
  };
  const lines = input.misses.map((m) =>
    m.kind === "learn"
      ? `- 证据 ${m.attemptId}｜${nameOf(m.kpId)}｜${m.arm ? `之前用${armName(m.arm)}讲过` : "之前没讲过"}｜猜他${m.predicted >= 0.5 ? "能" : "不能"}独立答对（${m.predicted.toFixed(2)}），实际${m.correct ? "答对了" : "答错了"}｜学生原话：${m.quote}`
      : `- 证据 ${m.messageId}｜${nameOf(m.kpId)}｜导师用${armName(m.arm ?? "")}讲，猜他${m.predicted >= 0.5 ? "会" : "不会"}觉得舒服（${m.predicted.toFixed(2)}），实际${m.feel ? "没有负面反应" : "之后两轮内说了听不懂、放弃或点了踩"}`
  );
  const current = activeNotes(input.notes);
  const text = [
    "整段对话（每条带消息 id）：",
    ...input.transcript.map(
      (l) => `[${l.id}] ${l.role === "user" ? "学生" : "导师"}：${l.text}`
    ),
    "",
    "猜错的地方：",
    ...lines,
    "",
    "已有笔记（hits 对上次数 / misses 对不上次数）：",
    ...(current.length > 0
      ? current.map(
          (n) =>
            `- ${n.id}：${n.text}｜条件 ${JSON.stringify(n.when)}｜预计 ${n.expect}｜hits ${n.hits}、misses ${n.misses}`
        )
      : ["（无）"]),
  ].join("\n");

  const result = await askJson([{ text, type: "text" }], notesSchema, {
    maxTokens: 4000,
    system: SYSTEM,
    tier: "review",
  });
  const evidenceIds = new Set(input.misses.map(missId));
  return {
    evidenceIds,
    ops: result.ops.map((o) => ({
      evidence: o.evidence,
      expect: o.expect,
      id: o.id,
      op: o.op,
      text: o.text,
      when: {
        kind: any(o.kind),
        order: any(o.order),
        representation: any(o.representation),
      },
    })),
  };
}
