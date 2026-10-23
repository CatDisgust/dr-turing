import { describe, expect, it } from "vitest";
import type { TutorPlan } from "@/lib/types";
import { mergePlan, nameStartFrom } from "../plan-merge";

const rulePlan: TutorPlan = {
  action_type: "explain",
  check_misconception_first: "把丢失更新当成事务失败",
  disclosure_level: "partial",
  elicits_production: true,
  filled_by: "rules",
  next_action: "teach",
  order: "example_first",
  prompt: "aha",
  rationale: "规则④",
  representation: "analogy",
  reveals_answer: false,
  rule: 4,
  start_from: [],
  target_kc: "kp_a",
};

const filled = {
  action_type: "worked_example" as const,
  check_misconception_first: true,
  disclosure_level: "partial" as const,
  rationale: "从事务讲起",
  start_from: ["kp_pre", "kp_elsewhere"],
};

describe("mergePlan", () => {
  it("动作、目标、提示词只认规则，其余用 Claude 填的", () => {
    const plan = mergePlan(
      { ...rulePlan },
      { ...filled },
      {
        justTellMe: false,
        misconception: "把丢失更新当成事务失败",
        prereqIds: ["kp_pre"],
      }
    );
    expect(plan.next_action).toBe("teach");
    expect(plan.prompt).toBe("aha");
    expect(plan.target_kc).toBe("kp_a");
    expect(plan.action_type).toBe("worked_example");
    // 讲法只认代码挑的（学生建模方案 C）
    expect(plan.representation).toBe("analogy");
    expect(plan.order).toBe("example_first");
    expect(plan.rationale).toBe("从事务讲起");
    expect(plan.filled_by).toBe("claude");
  });

  it("起点只能是给出的先修", () => {
    const plan = mergePlan(rulePlan, filled, {
      justTellMe: false,
      prereqIds: ["kp_pre"],
    });
    expect(plan.start_from).toEqual(["kp_pre"]);
  });

  it("点了直接告诉我就必须讲全，也就不要求产出", () => {
    const plan = mergePlan(
      rulePlan,
      { ...filled, disclosure_level: "hint" },
      { justTellMe: true, prereqIds: [] }
    );
    expect(plan.disclosure_level).toBe("full");
    expect(plan.elicits_production).toBe(false);
  });

  it("误解原文来自规则，Claude 只决定要不要先查", () => {
    const yes = mergePlan(rulePlan, filled, {
      justTellMe: false,
      misconception: "把丢失更新当成事务失败",
      prereqIds: [],
    });
    expect(yes.check_misconception_first).toBe("把丢失更新当成事务失败");
    const no = mergePlan(
      rulePlan,
      { ...filled, check_misconception_first: false },
      { justTellMe: false, misconception: "x", prereqIds: [] }
    );
    expect(no.check_misconception_first).toBeUndefined();
  });

  it("理由为空就留规则的", () => {
    const plan = mergePlan(
      rulePlan,
      { ...filled, rationale: " " },
      {
        justTellMe: false,
        prereqIds: [],
      }
    );
    expect(plan.rationale).toBe("规则④");
  });

  it("规则算出的已会先修一定留着，Claude 填空也不会冲掉", () => {
    const plan = mergePlan(
      { ...rulePlan, start_from: ["kp_rule"] },
      { ...filled, start_from: [] },
      { justTellMe: false, prereqIds: ["kp_pre", "kp_rule"] }
    );
    expect(plan.start_from).toEqual(["kp_rule"]);
  });

  it("起点的名字存进 plan，标签直接显示", () => {
    const plan = nameStartFrom(
      { ...rulePlan, start_from: ["kp_pre", "kp_x"] },
      [{ id: "kp_pre", name: "丢失更新" }]
    );
    expect(plan.start_from_names).toEqual(["丢失更新", "kp_x"]);
  });
});
