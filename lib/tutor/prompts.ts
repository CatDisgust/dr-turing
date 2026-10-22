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

// 按 plan.prompt 每轮只加载一段：讲解用 Aha v0.2.0 SKILL.md 原文，其余动作各有一段短提示词
export const ahaPrompt = load("aha-SKILL.md");

export const tutorPrompts: Record<TutorPlan["prompt"], string> = {
  aha: ahaPrompt,
  counterexample: load("counterexample.md"),
  min_hint: load("min_hint.md"),
  question: load("question.md"),
  review: load("review.md"),
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
  diagram: "示意图（用文字或 ASCII 画）",
  formula: "公式",
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
