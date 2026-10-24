import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { TutorPlan } from "@/lib/types";

const PROMPTS_DIR = path.join(process.cwd(), "lib/tutor/prompts");

function load(name: string): string {
  const raw = readFileSync(path.join(PROMPTS_DIR, name), "utf8");
  // 去掉 SKILL.md 的 YAML frontmatter，只留正文
  return raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

// 画图（2026-10-24 用户要求）：聊天框会把 mermaid 代码块画成真图，别再画字符画。
// 每段提示词后面都带上，和提示词一起缓存
export const DIAGRAM_RULE = `画图：要用图说明关系（谁等谁、先后顺序、调用流程、结构）时，用 \`\`\`mermaid 代码块画，不要用字符画或 ASCII 框线。
- 用 flowchart（flowchart LR 或 flowchart TD）或 sequenceDiagram，一张图不超过 8 个节点
- 节点文字用中文，并用双引号包起来，例如 A["事务 A<br/>持有 X"]；箭头上的字也加引号，例如 A -->|"等 Y"| B
- 只画一张小图，图前后用一两句话说明它在说什么。一步一步的时间线用普通文字或表格，不用画图`;

// 按 plan.prompt 每轮只加载一段：讲解用 Aha v0.2.0 SKILL.md 原文，其余动作各有一段短提示词
export const ahaPrompt = load("aha-SKILL.md");

const withDiagrams = (prompt: string) => `${prompt}\n\n${DIAGRAM_RULE}`;

export const tutorPrompts: Record<TutorPlan["prompt"], string> = {
  aha: withDiagrams(ahaPrompt),
  counterexample: withDiagrams(load("counterexample.md")),
  min_hint: withDiagrams(load("min_hint.md")),
  question: withDiagrams(load("question.md")),
  review: withDiagrams(load("review.md")),
};

const DISCLOSURE = {
  full: "完整讲清楚，可以直接给结论和答案",
  hint: "只给提示，不给答案",
  partial: "只补学生缺的那一段，已经会的不重讲",
  question: "只提问，不讲解",
} as const;

const REPRESENTATION = {
  analogy: "生活中的类比",
  code: "一小段代码",
  diagram: "示意图（用 mermaid 画）",
  formula: "公式",
} as const;

const ORDER = {
  definition_first: "先给定义，再用例子说明",
  example_first: "先举一个具体例子，再引出定义",
} as const;

// 把 plan 写成导师能照着做的几行话，放在本轮短提示词后面
export function describePlan(
  plan: TutorPlan,
  nameOf: (kpId: string) => string,
  willAsk: boolean
): string {
  const lines = [
    "本轮规划（系统给你的，回复里不要提到“规划”）：",
    `- 知识点：「${nameOf(plan.target_kc)}」`,
    `- 披露程度：${DISCLOSURE[plan.disclosure_level]}`,
    `- 表征：优先用${REPRESENTATION[plan.representation]}`,
    `- 顺序：${ORDER[plan.order]}`,
    plan.elicits_production
      ? "- 让学生自己说出或推出至少一步，不要替他说完"
      : "- 学生现在需要的是讲清楚，先别逼他产出",
  ];
  if (plan.start_from.length > 0) {
    lines.push(
      `- 学生已经理解：${plan.start_from.map((id) => `「${nameOf(id)}」`).join("")}。从这里接着讲，不要重讲它们，可以拿它们来类比`
    );
  }
  if (plan.check_misconception_first) {
    lines.push(
      `- 先确认学生是不是有这个误解：「${plan.check_misconception_first}」`
    );
  }
  if (willAsk) {
    lines.push(
      "- 你说完之后，系统会单独给出一道题让学生作答。你自己不要出题、不要提问，也不要透露那道题的答案"
    );
  }
  return lines.join("\n");
}
