import "server-only";
import { z } from "zod";
import { askJson } from "@/lib/graph/ask";
import { plannerContext } from "@/lib/learner/context";
import type { CourseGraph, LearnerState, TutorPlan } from "@/lib/types";
import { mergePlan } from "./plan-merge";

// 规划器的第二步：七条规则已经定了动作（planTurn），讲法由代码按得分挑（学生建模方案 C）；
// 其余字段——从哪讲起、讲多少、要不要先查误解、理由——交给 Claude（低档）按目标节点和两跳先修来填。
// 只读切片，不读整张图；调用失败就用规则的默认值

const fillSchema = z.object({
  action_type: z.enum(["explain", "scaffold", "hint", "ask", "worked_example"]),
  check_misconception_first: z.boolean(),
  disclosure_level: z.enum(["question", "hint", "partial", "full"]),
  rationale: z.string(),
  start_from: z.array(z.string()),
  student_reaction: z.enum(["none", "still_lost", "too_abstract"]),
});

export type PlanFill = z.infer<typeof fillSchema>;

const ACTION_NAMES: Record<TutorPlan["next_action"], string> = {
  diagnose_misconception: "诊断误解（举反例）",
  hint: "给最小提示",
  independent_check: "出一道独立题",
  review: "复习",
  teach: "讲解",
  variant: "出一道变式题",
};

const SYSTEM = [
  "你是 Dr.Turing 的教学规划器。导师这一轮的动作已经由规则定好，你不能改动作，只填这一轮怎么做。",
  "",
  "要填的字段：",
  "- start_from：从哪些已经理解的先修讲起（只能从给出的先修 id 里选，可以为空）。M ≥ 0.6 的先修算已理解，不必重讲。",
  "- disclosure_level：讲到什么程度。question 只提问不讲；hint 给一步提示；partial 讲一部分、留一步让学生自己推；full 完整讲清。",
  "- action_type：explain 讲解 / worked_example 边做边讲的例题 / scaffold 搭脚手架引导 / hint 提示 / ask 提问。",
  "- check_misconception_first：这个点上有没纠正的误解时，要不要先排查它。",
  "- rationale：一两句中文，说明为什么这样安排，引用具体的 M、O、H、先修或学生原话。",
  "- student_reaction：学生这一轮的话是不是在说听不懂。still_lost 是还是没懂、越听越糊涂（比如“还是不懂”“没明白”）；too_abstract 是嫌太抽象、想要具体例子（比如“太抽象了”“能举个例子吗”）；都不是就填 none。只看这一轮学生说的话，拿不准填 none。",
  "",
  "原则：让学生自己做出来的部分尽量多，但他刚接触、又没有能借力的先修、或者求助依赖很高（H ≥ 0.5）时，讲完整一些。学生说“直接告诉我”时必须 full。",
].join("\n");

export async function fillPlan(input: {
  graph: CourseGraph;
  state: LearnerState;
  sessionId: string;
  rulePlan: TutorPlan;
  studentText: string;
  justTellMe: boolean;
}): Promise<{ plan: TutorPlan; reaction: PlanFill["student_reaction"] }> {
  const { graph, state, rulePlan } = input;
  const ctx = plannerContext(graph, state, rulePlan.target_kc, input.sessionId);
  const t = ctx.target;
  const openMisconceptions = t.misconceptions
    .filter((m) => m.status !== "repaired" && m.text)
    .map((m) => m.text);
  const prompt = [
    `本轮动作（规则${"①②③④⑤⑥⑦"[rulePlan.rule - 1]}定的，不能改）：${ACTION_NAMES[rulePlan.next_action]}`,
    "",
    `目标知识点：${t.id}「${t.name}」（${t.kind}）：${t.definition}`,
    `状态：M ${t.M}、O ${t.O}、H ${t.H ?? "无数据"}、阶段 ${t.stage}、${t.hasEvidence ? "有答题证据" : "还没有答题证据"}`,
    `没纠正的误解：${openMisconceptions.length > 0 ? openMisconceptions.join("；") : "无"}`,
    "",
    "先修（hops = 隔几层）：",
    ...(ctx.prereqs.length > 0
      ? ctx.prereqs.map(
          (p) =>
            `- ${p.id}「${p.name}」hops ${p.hops}：M ${p.M}、O ${p.O}、H ${p.H ?? "无数据"}`
        )
      : ["- 无"]),
    "",
    `学生说过的偏好：${state.profile.statedPreferences.map((p) => p.text).join("；") || "无"}`,
    `学生这一轮说的话：${input.studentText}`,
    input.justTellMe ? "学生点了“直接告诉我”。" : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const filled = await askJson([{ text: prompt, type: "text" }], fillSchema, {
    maxTokens: 2000,
    system: SYSTEM,
    tier: "fast",
  });
  return {
    plan: mergePlan(rulePlan, filled, {
      justTellMe: input.justTellMe,
      misconception: rulePlan.check_misconception_first,
      prereqIds: ctx.prereqs.map((p) => p.id),
    }),
    reaction: filled.student_reaction,
  };
}
