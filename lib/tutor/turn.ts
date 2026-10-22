import "server-only";
import type { TurnSignal } from "@/lib/learner/policy";
import {
  attemptFromGrading,
  misconceptionText,
  pickQuestion,
} from "@/lib/learner/question";
import { applyEvidence, applySignal, touchNode } from "@/lib/learner/update";
import type {
  CourseGraph,
  KnowledgePoint,
  LearnerState,
  PendingQuestion,
} from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import { classifyQuestion } from "./classify";
import { gradeAnswer } from "./grade";

// 一轮对话里引擎这一侧要做的事：快捷按钮、批改上一轮留的题、归类新问题。
// 返回新状态、给导师的情况说明，以及讲完之后要不要出题

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
  graded?: { point: KnowledgePoint; correct: boolean; misconception?: string };
  // 写进导师 system 的本轮情况；null 就是普通讲解
  note: string | null;
  // 讲完之后就这个点出一道题
  askAbout?: KnowledgePoint;
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
  const state = applySignal(turn.state, signal, turn.now);
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
  const grading = await gradeAnswer(point, pending.question, turn.text);
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
  const misconception = misconceptionText(point, attempt.misconceptionId);
  if (grading.correct) {
    return {
      askAbout: point,
      graded: { correct: true, point },
      note: `学生刚答对了这道题：「${pending.question}」。用一两句话肯定他说对的地方，引用他的原话，不要再重讲一遍。`,
      state: { ...state, pendingQuestion: undefined },
      touched: point,
    };
  }
  // 答错了题还留着，导师接下来的反馈本身就是提示，再答对按“要过提示”算
  return {
    graded: { correct: false, misconception, point },
    note: [
      `学生答错了这道题：「${pending.question}」。`,
      misconception ? `他的错法像这个常见误解：${misconception}。` : "",
      "不要直接给答案。用一个反例或一个追问让他自己发现哪里不对，然后请他再答一次。",
    ].join(""),
    state: {
      ...state,
      pendingQuestion: { ...pending, help: atLeast(pending.help, "hint") },
    },
    touched: point,
  };
}

// 新问题：归类到一个点，虚线亮，讲完出一道题
export async function questionTurn(turn: Turn): Promise<TurnResult> {
  const point =
    turn.text.trim() === ""
      ? null
      : await classifyQuestion(turn.graph, turn.text);
  if (!point) {
    return { note: null, state: turn.state };
  }
  return {
    askAbout: point,
    note: null,
    state: touchNode(turn.state, point.id, turn.sessionId),
    touched: point,
  };
}

// 讲完之后出题：选好题、存成 PendingQuestion，返回题面
export function askQuestion(
  turn: Pick<Turn, "sessionId" | "turnId" | "now">,
  state: LearnerState,
  point: KnowledgePoint
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
        sessionId: turn.sessionId,
      },
    },
  };
}
