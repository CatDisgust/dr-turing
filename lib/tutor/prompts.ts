import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

const PROMPTS_DIR = path.join(process.cwd(), "lib/tutor/prompts");

function load(name: string): string {
  const raw = readFileSync(path.join(PROMPTS_DIR, name), "utf8");
  // 去掉 SKILL.md 的 YAML frontmatter，只留正文
  return raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

// D1：Aha v0.2.0 SKILL.md 原文作为整段系统提示。D9 起改成按 plan.prompt 每轮只加载一段。
export const ahaPrompt = load("aha-SKILL.md");
