import type { TutorPlan } from "@/lib/types";

// 画面三的验收（D11）：同一句话，A、B 的规划在这 4 项里至少 3 项不同；连跑 5 次方向不变，
// 即每一项在每次里要么都不同、要么都相同

export const COMPARED = [
  "start_from",
  "disclosure_level",
  "elicits_production",
  "check_misconception_first",
] as const;

export type ComparedField = (typeof COMPARED)[number];

export const MIN_DIFFERENT = 3;

// start_from 按集合比；check_misconception_first 只看查不查，不看误解原文
function fieldValue(plan: TutorPlan, field: ComparedField): string {
  if (field === "start_from") {
    return [...plan.start_from].sort().join(",");
  }
  if (field === "check_misconception_first") {
    return String(Boolean(plan.check_misconception_first));
  }
  return String(plan[field]);
}

export function differs(a: TutorPlan, b: TutorPlan, field: ComparedField) {
  return fieldValue(a, field) !== fieldValue(b, field);
}

export type CompareVerdict = {
  fields: {
    field: ComparedField;
    differentRuns: number;
    stable: boolean;
  }[];
  // 每次都不同的项数
  alwaysDifferent: number;
  stable: boolean;
  pass: boolean;
};

export function compareRuns(
  runs: { a: TutorPlan; b: TutorPlan }[]
): CompareVerdict {
  const fields = COMPARED.map((field) => {
    const differentRuns = runs.filter((r) => differs(r.a, r.b, field)).length;
    return {
      differentRuns,
      field,
      stable: differentRuns === 0 || differentRuns === runs.length,
    };
  });
  const alwaysDifferent = fields.filter(
    (f) => runs.length > 0 && f.differentRuns === runs.length
  ).length;
  const stable = fields.every((f) => f.stable);
  return {
    alwaysDifferent,
    fields,
    pass: runs.length > 0 && stable && alwaysDifferent >= MIN_DIFFERENT,
    stable,
  };
}
