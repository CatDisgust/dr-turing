import type { Ability, Attempt, LearnerState } from "@/lib/types";
import { isGraded } from "./mastery";

// 三项底层能力（用户 2026-10-22 定）：自己解释、独立性、保持。
// 每项都是一个比例，用贝叶斯比例估计：先假设他做了 α + β 次、成功 α 次，证据少时贴着默认值。
// 只计算和显示，不改 BKT、不改调度；讲解时转成几句话交给导师

// 先验：相当于“做过 4 次、对一半”（假设）
const ALPHA = 2;
const BETA = 2;
// 少于这么多条证据就显示“还不确定”（假设）
export const MIN_EVIDENCE = 3;

export function betaEstimate(k: number, n: number) {
  const a = k + ALPHA;
  const b = n - k + BETA;
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  return {
    high: Math.min(1, mean + 1.96 * sd),
    low: Math.max(0, mean - 1.96 * sd),
    value: mean,
  };
}

function ability(
  key: Ability["key"],
  label: string,
  trials: { attempt: Attempt; success: boolean }[]
): Ability {
  const k = trials.filter((t) => t.success).length;
  const n = trials.length;
  return {
    ...betaEstimate(k, n),
    certain: n >= MIN_EVIDENCE,
    evidence: trials
      .map((t) => ({
        at: t.attempt.at,
        quote: t.attempt.quote,
        success: t.success,
      }))
      .reverse(),
    k,
    key,
    label,
    n,
  };
}

// 全部课程的证据放在一起算：能力是跨知识点的
export function computeAbilities(states: LearnerState[]): Ability[] {
  const graded = states
    .flatMap((s) => Object.values(s.nodes))
    .flatMap((node) => node.attempts)
    .filter(isGraded)
    .sort((a, b) => a.at.localeCompare(b.at));

  return [
    // 自己解释：批改时 Claude 按评分表标的“有没有自己说出一步推理或一个例子”
    ability(
      "self_explanation",
      "自己解释",
      graded.map((attempt) => ({ attempt, success: attempt.producedStep }))
    ),
    // 独立性：作答前没要提示或答案的比例，即全图的 1 − H
    ability(
      "independence",
      "独立性",
      graded.map((attempt) => ({ attempt, success: !attempt.hinted }))
    ),
    // 保持：隔天复习题独立答对的比例
    ability(
      "retention",
      "保持",
      graded
        .filter(
          (a) => a.questionKind === "review" || a.type === "review_correct"
        )
        .map((attempt) => ({
          attempt,
          success: attempt.correct === true && !attempt.hinted,
        }))
    ),
  ];
}

const LEVEL = (value: number) => {
  if (value >= 0.65) {
    return "high";
  }
  return value <= 0.35 ? "low" : "mid";
};

// 讲解前交给导师的几句话：固定模板，证据不够的不说，只调讲法不贴标签
export function describeAbilities(abilities: Ability[]): string | null {
  const lines: string[] = [];
  for (const a of abilities) {
    if (!a.certain) {
      continue;
    }
    const level = LEVEL(a.value);
    if (a.key === "self_explanation" && level === "high") {
      lines.push("这个学生常能用自己的话讲出推理，可以多留一步让他自己推。");
    } else if (a.key === "self_explanation" && level === "low") {
      lines.push(
        "这个学生很少自己说出推理，先给一个具体例子，再请他照着说一步。"
      );
    } else if (a.key === "independence" && level === "low") {
      lines.push("这个学生常要提示，提示拆得更小，每次只给一步。");
    } else if (a.key === "retention" && level === "low") {
      lines.push("这个学生隔天容易忘，讲完用一句话帮他把要点串起来。");
    }
  }
  return lines.length > 0
    ? `学生的学习特点（系统统计的，不要对学生提到）：${lines.join("")}`
    : null;
}
