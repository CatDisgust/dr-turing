import type {
  CourseGraph,
  KnowledgePoint,
  LearnerState,
  Lesson,
} from "@/lib/types";
import { HALF_M } from "./config";
import { isGraded } from "./mastery";

// 诊断入口（D10）：学生说“我要学第 N 课”，先沿先修边往回找这一课依赖的前置，
// 从还没有证据的前置里挑最多 3 个，用它们自带的检查题挨个问；问完再开讲这一课。
// 全是规则：识别、挑题、选开讲的点都不调模型

export const MAX_DIAGNOSIS = 3;

const CN_DIGITS: Record<string, number> = {
  一: 1,
  七: 7,
  三: 3,
  九: 9,
  二: 2,
  五: 5,
  八: 8,
  六: 6,
  十: 10,
  四: 4,
};

function chineseNumber(text: string): number {
  if (/^\d+$/.test(text)) {
    return Number(text);
  }
  // 只到二十几：十、十二、二十三
  if (text.includes("十")) {
    const [tens, ones] = text.split("十");
    return (tens ? CN_DIGITS[tens] : 1) * 10 + (ones ? CN_DIGITS[ones] : 0);
  }
  return CN_DIGITS[text] ?? Number.NaN;
}

// “我要学第 3 课”“想学第三讲”“learn W3”“Week 3”“lesson 3”。要有“学 / learn”才算，
// 免得“第 3 课里的锁是什么”这种提问被当成诊断
export function parseLessonRequest(
  text: string,
  graph: CourseGraph
): Lesson | null {
  if (!/学|learn|study/i.test(text)) {
    return null;
  }
  const match =
    text.match(/第\s*([0-9一二三四五六七八九十]+)\s*(?:课|讲|周|节)/) ??
    text.match(/\b(?:W|week|lesson)\s*0?(\d+)\b/i);
  if (!match) {
    return null;
  }
  const n = chineseNumber(match[1]);
  return (
    graph.lessons.find((l) => l.index === n) ??
    graph.lessons.find((l) =>
      new RegExp(`(?:^|[^0-9])W0?${n}(?:[^0-9]|$)`, "i").test(l.title)
    ) ??
    null
  );
}

const prereqsOf = (graph: CourseGraph, id: string) =>
  graph.edges
    .filter((e) => e.type === "prereq" && e.to === id)
    .map((e) => e.from);

const hasEvidence = (state: LearnerState, id: string) =>
  state.nodes[id]?.attempts.some(isGraded) ?? false;

// 这一课之外、两跳以内的前置里，还没有答题证据、又有检查题的，按“这一课有几个点依赖它”排序
export function diagnosisTargets(
  graph: CourseGraph,
  state: LearnerState,
  lessonId: string
): KnowledgePoint[] {
  const inLesson = new Set(
    graph.points.filter((p) => p.lessonId === lessonId).map((p) => p.id)
  );
  const score = new Map<string, number>();
  for (const id of inLesson) {
    const oneHop = prereqsOf(graph, id);
    const twoHop = oneHop.flatMap((p) => prereqsOf(graph, p));
    for (const [hops, ids] of [
      [1, oneHop],
      [2, twoHop],
    ] as const) {
      for (const pre of ids) {
        if (inLesson.has(pre)) {
          continue;
        }
        // 一跳的前置比两跳的分量重
        score.set(pre, (score.get(pre) ?? 0) + (hops === 1 ? 2 : 1));
      }
    }
  }
  return [...score.entries()]
    .filter(([id]) => !hasEvidence(state, id))
    .map(([id, s]) => ({ point: graph.points.find((p) => p.id === id), s }))
    .filter(
      (x): x is { point: KnowledgePoint; s: number } =>
        x.point !== undefined && x.point.checkQuestions.length > 0
    )
    .sort((a, b) => b.s - a.s || a.point.id.localeCompare(b.point.id))
    .slice(0, MAX_DIAGNOSIS)
    .map((x) => x.point);
}

// 问完从哪个点开讲：两跳以内已掌握的前置最多的点，这样讲解能接着他会的讲；
// 一样多就挑没有课内前置的，再按课件顺序
export function lessonStart(
  graph: CourseGraph,
  state: LearnerState,
  lessonId: string
): KnowledgePoint | null {
  const points = graph.points.filter((p) => p.lessonId === lessonId);
  const inLesson = new Set(points.map((p) => p.id));
  const owned = (p: KnowledgePoint) => {
    const oneHop = prereqsOf(graph, p.id);
    const near = new Set([
      ...oneHop,
      ...oneHop.flatMap((x) => prereqsOf(graph, x)),
    ]);
    return [...near].filter((pre) => (state.nodes[pre]?.M ?? 0) >= HALF_M)
      .length;
  };
  const isRoot = (p: KnowledgePoint) =>
    prereqsOf(graph, p.id).some((pre) => inLesson.has(pre)) ? 0 : 1;
  return (
    [...points].sort(
      (a, b) =>
        owned(b) - owned(a) ||
        isRoot(b) - isRoot(a) ||
        points.indexOf(a) - points.indexOf(b)
    )[0] ?? null
  );
}
