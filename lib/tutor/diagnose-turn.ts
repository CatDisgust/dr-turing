import "server-only";
import { HALF_M } from "@/lib/learner/config";
import {
  diagnosisTargets,
  lessonStart,
  parseLessonRequest,
} from "@/lib/learner/diagnose";
import type { LearnerState, Lesson, TutorPlan } from "@/lib/types";
import {
  answerTurn,
  askQuestion,
  planAndAsk,
  type Turn,
  type TurnResult,
} from "./turn";

// 诊断入口这一侧的轮次：开始诊断、批改诊断题、问完开讲。
// 诊断题的规划由规则直接给，不走规划器；问完开讲时才交给规划器

export type Step = Awaited<ReturnType<typeof planAndAsk>>;

type Diagnosed = { result: TurnResult; step: Step };

const lessonOf = (turn: Turn, lessonId: string) =>
  turn.graph.lessons.find((l) => l.id === lessonId);

function activeDiagnosis(turn: Turn) {
  const d = turn.state.diagnosis;
  return d && d.sessionId === turn.sessionId ? d : null;
}

function diagnosisPlan(
  kpId: string,
  name: string,
  lesson: Lesson,
  index: number,
  total: number
): TutorPlan {
  return {
    action_type: "ask",
    disclosure_level: "question",
    elicits_production: true,
    filled_by: "diagnosis",
    next_action: "independent_check",
    order: "example_first",
    prompt: "question",
    rationale: `诊断「${lesson.title}」的前置（${index}/${total}）：「${name}」还没有答题记录，先问一道它的检查题`,
    representation: "analogy",
    reveals_answer: false,
    rule: 0,
    start_from: [],
    target_kc: kpId,
  };
}

// 问下一道诊断题；没有了就开讲
function askNext(
  turn: Turn,
  state: LearnerState,
  lesson: Lesson,
  queue: string[],
  asked: string[],
  base: Omit<TurnResult, "state" | "touched" | "note">,
  lead: string
): Promise<Diagnosed> {
  const total = asked.length + queue.length;
  for (const [i, kpId] of queue.entries()) {
    const point = turn.graph.points.find((p) => p.id === kpId);
    const next = point ? askQuestion(turn, state, point) : null;
    if (!(point && next)) {
      continue;
    }
    const nowAsked = [...asked, kpId];
    const result: TurnResult = {
      ...base,
      note: `${lead}这一轮不要讲解任何知识点，也不要自己出题。`,
      state: {
        ...next.state,
        diagnosis: {
          asked: nowAsked,
          lessonId: lesson.id,
          queue: queue.slice(i + 1),
          sessionId: turn.sessionId,
        },
      },
      touched: point,
    };
    return Promise.resolve({
      result,
      step: {
        note: result.note,
        plan: diagnosisPlan(
          point.id,
          point.name,
          lesson,
          nowAsked.length,
          total
        ),
        question: next.question,
        state: result.state,
      },
    });
  }
  return startLesson(turn, state, lesson, base, lead);
}

// 诊断结束：从这一课合适的点开讲。讲解一定跳过已经答对（半亮以上）的前置
async function startLesson(
  turn: Turn,
  state: LearnerState,
  lesson: Lesson,
  base: Omit<TurnResult, "state" | "touched" | "note">,
  lead: string
): Promise<Diagnosed> {
  const cleared: LearnerState = {
    ...state,
    diagnosis: undefined,
    pendingQuestion: undefined,
  };
  const start = lessonStart(turn.graph, cleared, lesson.id);
  const result: TurnResult = {
    ...base,
    note: `${lead}现在开始讲「${lesson.title}」。`,
    state: cleared,
    touched: start ?? undefined,
  };
  const step = await planAndAsk(turn, result);
  if (step.plan) {
    const near = new Set(
      turn.graph.edges
        .filter((e) => e.type === "prereq" && e.to === step.plan?.target_kc)
        .map((e) => e.from)
    );
    for (const id of [...near]) {
      for (const e of turn.graph.edges) {
        if (e.type === "prereq" && e.to === id) {
          near.add(e.from);
        }
      }
    }
    const owned = [...near].filter(
      (id) => (step.state.nodes[id]?.M ?? 0) >= HALF_M
    );
    step.plan = {
      ...step.plan,
      start_from: [...new Set([...step.plan.start_from, ...owned])],
    };
  }
  return { result, step };
}

// 学生说“我要学第 N 课”
export function diagnosisStart(turn: Turn): Promise<Diagnosed | null> {
  const lesson = parseLessonRequest(turn.text, turn.graph);
  if (!lesson) {
    return Promise.resolve(null);
  }
  const state = { ...turn.state, pendingQuestion: undefined };
  const targets = diagnosisTargets(turn.graph, state, lesson.id);
  if (targets.length === 0) {
    return startLesson(
      turn,
      state,
      lesson,
      {},
      `学生想学「${lesson.title}」，这一课的前置都已经有记录，不用再测。`
    );
  }
  return askNext(
    turn,
    state,
    lesson,
    targets.map((p) => p.id),
    [],
    {},
    `学生想学「${lesson.title}」。开讲前先用 ${targets.length} 道小题看看前面的基础。用一两句话告诉他：先做几道小题，答不上来也没关系，直接说不会就行。`
  );
}

// 诊断题的回答：批改、记证据，不管对错都不追问，接着问下一道
export async function diagnosisAnswer(turn: Turn): Promise<Diagnosed | null> {
  const d = activeDiagnosis(turn);
  const pending = turn.state.pendingQuestion;
  const lesson = d ? lessonOf(turn, d.lessonId) : undefined;
  if (!(d && lesson && pending && d.asked.includes(pending.kpId))) {
    return null;
  }
  const graded = await answerTurn(turn);
  const state = {
    ...(graded?.state ?? turn.state),
    pendingQuestion: undefined,
  };
  let lead = "学生说不会这道题，没关系，别讲解。";
  if (graded?.graded && !graded.graded.dontKnow) {
    lead = graded.graded.correct
      ? "学生答对了上一道诊断题，一句话肯定即可。"
      : "学生答错了上一道诊断题。不要纠正、不要讲解，一句话说“记下了，待会儿会讲到”。";
  }
  return askNext(
    turn,
    state,
    lesson,
    d.queue,
    d.asked,
    { graded: graded?.graded },
    lead
  );
}

// 诊断中点了“先不做题”：结束诊断，直接开讲
export function diagnosisSkip(turn: Turn): Promise<Diagnosed | null> {
  const d = activeDiagnosis(turn);
  const lesson = d ? lessonOf(turn, d.lessonId) : undefined;
  if (!(d && lesson)) {
    return Promise.resolve(null);
  }
  return startLesson(
    turn,
    turn.state,
    lesson,
    {},
    "学生不想再做诊断题了，别追问。"
  );
}
