import "server-only";
import { BKT } from "@/lib/learner/config";
import {
  B_HIGH,
  engagementOf,
  recordEvent,
  signals,
} from "@/lib/learner/events";
import { notesFor } from "@/lib/learner/notes";
import { planTurn } from "@/lib/learner/planner";
import type { TurnSignal } from "@/lib/learner/policy";
import { predict } from "@/lib/learner/predict";
import { attemptFromGrading, pickQuestion } from "@/lib/learner/question";
import {
  applyEvidence,
  applySignal,
  learnRateOf,
  touchNode,
} from "@/lib/learner/update";
import type {
  Attempt,
  CourseGraph,
  KnowledgePoint,
  LearnerState,
  PendingQuestion,
  TutorPlan,
} from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import { classifyQuestion } from "./classify";
import { gradeAnswer } from "./grade";
import { fillPlan } from "./plan";

// 一轮对话里引擎这一侧要做的事：快捷按钮、批改上一轮留的题、归类新问题。
// 返回新状态和给导师的情况说明；之后 planAndAsk 定本轮动作、要不要出题

export type Turn = {
  graph: CourseGraph;
  state: LearnerState;
  sessionId: string;
  turnId: string;
  text: string;
  now: string;
};

export type TurnResult = {
  state: LearnerState;
  touched?: KnowledgePoint;
  graded?: {
    point: KnowledgePoint;
    correct: boolean;
    misconception?: string;
    // 学生说的是“不知道”，没给答案（也记一次答错）
    dontKnow?: boolean;
    attempt: Attempt;
  };
  // 写进导师 system 的本轮情况；null 就是普通讲解
  note: string | null;
};

const HELP_ORDER = ["none", "hint", "revealed"] as const;
const atLeast = (
  help: PendingQuestion["help"],
  floor: PendingQuestion["help"]
) => (HELP_ORDER.indexOf(help) >= HELP_ORDER.indexOf(floor) ? help : floor);

function pendingOf(turn: Turn) {
  const pending = turn.state.pendingQuestion;
  const point = turn.graph.points.find((p) => p.id === pending?.kpId);
  if (!(pending && point) || pending.sessionId !== turn.sessionId) {
    return null;
  }
  return { pending, point };
}

// 快捷按钮：给提示、直接告诉我、先不做题
export function signalTurn(turn: Turn, signal: TurnSignal): TurnResult {
  const state = applySignal(turn.state, signal);
  const open = pendingOf(turn);
  if (!open) {
    return { note: null, state };
  }
  const { pending, point } = open;
  if (signal === "skip") {
    return {
      note: "学生说先不做这道题。别追问，简短回应一句，然后问他接下来想弄懂什么。",
      state: { ...state, pendingQuestion: undefined },
      touched: point,
    };
  }
  const revealed = signal === "just_tell_me";
  return {
    note: revealed
      ? `学生想直接看这道题的答案：「${pending.question}」。把答案讲清楚，讲完请他用自己的话复述一遍。`
      : `学生要提示。题目是：「${pending.question}」。只给最小的一步提示，不要给出答案，最后把题目原样再问一遍。`,
    state: {
      ...state,
      pendingQuestion: {
        ...pending,
        help: atLeast(pending.help, revealed ? "revealed" : "hint"),
      },
    },
    touched: point,
  };
}

// 上一轮留了题：先批改。学生其实在问别的就返回 null，按新问题走
export async function answerTurn(turn: Turn): Promise<TurnResult | null> {
  const open = pendingOf(turn);
  if (!open) {
    return null;
  }
  const { pending, point } = open;
  const known = (turn.state.nodes[point.id]?.misconceptions ?? [])
    .filter((m) => m.status !== "repaired")
    .map((m) => m.text);
  const grading = await gradeAnswer(point, pending.question, turn.text, known);
  if (!grading.isAnswer) {
    return null;
  }
  const attempt = attemptFromGrading(pending, grading, {
    at: turn.now,
    id: generateUUID(),
    quote: turn.text,
    turnId: turn.turnId,
  });
  const state = applyEvidence(turn.state, turn.graph, point.id, attempt);
  const { misconception } = attempt;
  if (grading.correct) {
    return {
      graded: { attempt, correct: true, point },
      note: `学生刚答对了这道题：「${pending.question}」。用一两句话肯定他说对的地方，引用他的原话，不要再重讲一遍。`,
      state: { ...state, pendingQuestion: undefined },
      touched: point,
    };
  }
  // 答错了题还留着，导师接下来的反馈本身就是提示，再答对按“要过提示”算
  return {
    graded: {
      attempt,
      correct: false,
      dontKnow: grading.dontKnow,
      misconception,
      point,
    },
    note: grading.dontKnow
      ? `学生说不会这道题：「${pending.question}」。没关系，不要直接给答案。给一个最小的提示或拆成更小的一步，然后请他再试一次。`
      : [
          `学生答错了这道题：「${pending.question}」。`,
          misconception ? `从他的回答看，他可能以为：${misconception}。` : "",
          "不要直接给答案。用一个反例或一个追问让他自己发现哪里不对，然后请他再答一次。",
        ].join(""),
    state: {
      ...state,
      pendingQuestion: { ...pending, help: atLeast(pending.help, "hint") },
    },
    touched: point,
  };
}

// 图谱上点“开始学习”：目标点已经定了，不用归类。换了个点学，上一道没答的题就不等了
// （不算“先不做题”，不计入投入度）
export function startTurn(turn: Turn, kpId: string): TurnResult {
  const point = turn.graph.points.find((p) => p.id === kpId);
  if (!point) {
    return { note: null, state: turn.state };
  }
  const pending = turn.state.pendingQuestion;
  const state =
    pending && pending.kpId !== kpId
      ? { ...turn.state, pendingQuestion: undefined }
      : turn.state;
  return {
    note: null,
    state: touchNode(state, point.id, turn.sessionId),
    touched: point,
  };
}

// 新问题：归类到一个点，虚线亮，讲完出一道题。这次学习里已经碰过这个点，算追问
export async function questionTurn(turn: Turn): Promise<TurnResult> {
  const point =
    turn.text.trim() === ""
      ? null
      : await classifyQuestion(turn.graph, turn.text);
  if (!point) {
    return { note: null, state: turn.state };
  }
  const followup =
    turn.state.nodes[point.id]?.touchedInSession === turn.sessionId;
  const state = followup
    ? recordEvent(turn.state, "asked_followup")
    : turn.state;
  return {
    note: null,
    state: touchNode(state, point.id, turn.sessionId),
    touched: point,
  };
}

// 规则①的小提示之后也出题：不然投入度低时一直只给提示，学生没机会答对（建模审查第 1 条）
const ASKS: TutorPlan["next_action"][] = [
  "hint",
  "teach",
  "diagnose_misconception",
  "independent_check",
  "variant",
  "review",
];

// 负担 B 偏高（最近几轮说过还是不懂、太抽象）：提醒导师讲得更具体、步子更小，不改规则
function withBurden(note: string | null, state: LearnerState): string | null {
  if (signals(engagementOf(state)).B < B_HIGH) {
    return note;
  }
  return [
    note,
    "他最近几轮说过还是不懂或太抽象。这一轮讲得更具体：先举一个具体的例子，步子放小，一次只讲一步。",
  ]
    .filter(Boolean)
    .join("");
}

// 这一轮讲法用得上的教学笔记（检验过的，学生建模方案 E）：只影响怎么讲
function withNotes(
  note: string | null,
  state: LearnerState,
  plan: TutorPlan,
  graph: CourseGraph
): string | null {
  const kind = graph.points.find((p) => p.id === plan.target_kc)?.kind;
  const notes = notesFor(state.teachingNotes ?? [], plan, kind);
  if (notes.length === 0) {
    return note;
  }
  return [
    note,
    `之前验证过的、对这个学生怎么讲更有效的观察：${notes.map((n) => n.text).join("；")}。照着调整讲法，不要向学生提起这些观察。`,
  ]
    .filter(Boolean)
    .join("");
}

// 引擎这一步之后：规划器定本轮动作；讲解、出题、复习之后接一道题（还有题没答完就不出新题）
export async function planAndAsk(
  turn: Turn,
  result: TurnResult,
  signal?: TurnSignal
): Promise<{
  plan?: TutorPlan;
  question?: string;
  state: LearnerState;
  note: string | null;
}> {
  const { touched } = result;
  if (!touched || signal === "skip") {
    return { note: result.note, state: result.state };
  }
  const rulePlan = planTurn({
    graph: turn.graph,
    kpId: touched.id,
    sessionId: turn.sessionId,
    signal,
    state: result.state,
  });
  let plan = rulePlan;
  let { state } = result;
  try {
    const { plan: filledPlan, reaction } = await fillPlan({
      graph: turn.graph,
      justTellMe: signal === "just_tell_me",
      rulePlan,
      sessionId: turn.sessionId,
      state: result.state,
      studentText: turn.text,
    });
    plan = filledPlan;
    // 学生这句是在说“还是不懂”或“太抽象”：记成事件，计入负担 B（顺手判断，2026-10-23 用户定）
    if (reaction !== "none") {
      state = recordEvent(state, reaction);
    }
  } catch (error) {
    console.error("[plan] Claude 填 plan 失败，用规则默认值", error);
  }
  const note = withNotes(
    withBurden(result.note, state),
    state,
    plan,
    turn.graph
  );
  const stillOpen = state.pendingQuestion?.sessionId === turn.sessionId;
  const target = turn.graph.points.find((p) => p.id === plan.target_kc);
  if (
    stillOpen ||
    !target ||
    !ASKS.includes(plan.next_action) ||
    plan.reveals_answer
  ) {
    return { note, plan, state };
  }
  const asked = askQuestion(turn, state, target, plan.expect_like);
  if (asked) {
    return {
      note,
      plan,
      question: asked.question,
      state: asked.state,
    };
  }
  // 规则说该出题，但这个点这次的题都做完了：简短收个尾
  if (plan.prompt === "question" || plan.prompt === "review") {
    return {
      note: [
        note,
        "这个点这次的题都做完了。用一两句话总结他今天弄懂了什么，再问他接下来想弄懂什么。",
      ]
        .filter(Boolean)
        .join(""),
      plan,
      state,
    };
  }
  return { note, plan, state };
}

// 讲完之后出题：选好题、存成 PendingQuestion，返回题面
export function askQuestion(
  turn: Pick<Turn, "sessionId" | "turnId" | "now">,
  state: LearnerState,
  point: KnowledgePoint,
  // 这轮所选讲法“感受好”的后验均值（学生建模方案 C、D）
  expectLike?: number
): { state: LearnerState; question: string } | null {
  const picked = pickQuestion(
    point,
    state.nodes[point.id],
    turn.sessionId,
    turn.now
  );
  if (!picked) {
    return null;
  }
  return {
    question: picked.question,
    state: {
      ...state,
      pendingQuestion: {
        ...picked,
        askedAt: turn.now,
        askedTurnId: turn.turnId,
        help: "none",
        kpId: point.id,
        // 出题前先猜他能不能独立答对（学生建模方案 D）
        prediction: {
          ...predict(
            state.nodes[point.id]?.attempts ?? [],
            state.nodes[point.id]?.M ?? BKT.prior,
            learnRateOf(state)
          ),
          expectLike: expectLike ?? null,
        },
        sessionId: turn.sessionId,
      },
    },
  };
}
