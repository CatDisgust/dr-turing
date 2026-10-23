import type {
  CourseGraph,
  LearnerState,
  PersonalConcept,
  PersonalGraph,
} from "@/lib/types";
import { HALF_M } from "./config";
import { type Light, nodeLight } from "./light";
import { similar } from "./personal";

// 我的星图（个人知识库·只读地图，用户 2026-10-23 看过样稿说“继续”）：
// 跨所有课，只画这个学生碰过的东西——答过题或顺口提到过的课内知识点，加上课外概念。
// 拼成一张假的“课程图谱”交给星图组件画：每门课一块，课外一块。亮度只读，不能在这里改

export const OUTSIDE = "outside";

export type StarEvidence = {
  quote: string;
  at: string;
  sessionId: string;
  // 答题：批改过的作答；提到：对话里顺口说到；聊过：课外概念的出处
  how: "answer" | "mention" | "chat";
  correct?: boolean;
  // 回链：哪次对话（标题）、那次学的哪门课；找不到对话（比如预置数据）就没有
  chat?: string;
  course?: string;
};

export type Star = {
  id: string;
  kind: "course" | "outside";
  name: string;
  aliases: string[];
  definition: string;
  // 哪门课第几课，或“课外”
  where: string;
  light: Light;
  evidence: StarEvidence[];
  // 学生合并进来的（可以拆开）
  merged: NonNullable<PersonalConcept["merged"]>;
  // 常一起出现的：在同一次对话里都出现过，按一起出现的次数排
  related: string[];
};

// 并进课程知识点时的候选：图上没有的课内知识点也算
export type MergeTarget = Pick<
  Star,
  "id" | "kind" | "name" | "aliases" | "where"
>;

export type StarMap = {
  graph: CourseGraph;
  // 学生课程里所有知识点（课外概念可以并进去）
  catalog: MergeTarget[];
  lights: Record<string, Light>;
  progress: Record<string, number>;
  stars: Record<string, Star>;
  related: Record<string, string[]>;
};

// 一颗星最多列几条出处，新的在前
const MAX_EVIDENCE = 8;
// “常一起出现”最多列几个
const MAX_RELATED = 5;

const recent = (items: StarEvidence[]) =>
  items.toSorted((a, b) => b.at.localeCompare(a.at));

export function buildStarMap(input: {
  courses: readonly CourseGraph[];
  states: readonly LearnerState[];
  personal: PersonalGraph;
  // 对话 id → 标题
  chats?: Readonly<Record<string, string>>;
}): StarMap {
  const lessons: CourseGraph["lessons"] = [];
  const points: CourseGraph["points"] = [];
  const edges: CourseGraph["edges"] = [];
  const lights: StarMap["lights"] = {};
  const progress: StarMap["progress"] = {};
  const stars: StarMap["stars"] = {};
  const catalog: MergeTarget[] = [];
  const anchored = input.personal.anchored ?? {};
  const mentions = input.personal.courseMentions ?? {};

  input.courses.forEach((course, i) => {
    const whereOf = (lessonId: string) => {
      const lesson = course.lessons.find((l) => l.id === lessonId);
      return lesson ? `${course.name} · 第 ${lesson.index} 课` : course.name;
    };
    catalog.push(
      ...course.points.map((p) => ({
        aliases: p.aliases,
        id: p.id,
        kind: "course" as const,
        name: p.name,
        where: whereOf(p.lessonId),
      }))
    );
    const state = input.states.find((s) => s.courseId === course.courseId);
    const touched = course.points.filter((p) => {
      const node = state?.nodes[p.id];
      return (
        (node && (node.attempts.length > 0 || node.M >= HALF_M)) ||
        (mentions[p.id]?.length ?? 0) > 0
      );
    });
    if (touched.length === 0) {
      return;
    }
    const block = `course:${course.courseId}`;
    lessons.push({ fileIds: [], id: block, index: i + 1, title: course.name });
    const ids = new Set(touched.map((p) => p.id));
    for (const p of touched) {
      const node = state?.nodes[p.id];
      points.push({ ...p, lessonId: block });
      lights[p.id] = nodeLight(node).light;
      if (node) {
        progress[p.id] = node.O;
      }
      stars[p.id] = {
        aliases: p.aliases,
        definition: p.definition,
        evidence: recent([
          ...(node?.attempts ?? []).map((a) => ({
            at: a.at,
            correct: a.correct,
            how: "answer" as const,
            quote: a.quote,
            sessionId: a.sessionId,
          })),
          ...(mentions[p.id] ?? []).map((m) => ({
            ...m,
            how: "mention" as const,
          })),
        ]),
        id: p.id,
        kind: "course",
        light: lights[p.id],
        merged: anchored[p.id] ?? [],
        name: p.name,
        related: [],
        where: whereOf(p.lessonId),
      };
    }
    // 只留两头都在图上的先修边；易混边选中时才显示，也带上
    // 课程图谱里偶有重复边，去重免得画两遍
    const keys = new Set(edges.map((e) => `${e.type}:${e.from}:${e.to}`));
    for (const e of course.edges) {
      const key = `${e.type}:${e.from}:${e.to}`;
      if (
        e.type !== "part_of" &&
        ids.has(e.from) &&
        ids.has(e.to) &&
        !keys.has(key)
      ) {
        keys.add(key);
        edges.push(e);
      }
    }
  });

  const outside = input.personal.concepts.filter(
    (c) => c.status === "unanchored"
  );
  if (outside.length > 0) {
    lessons.push({
      fileIds: [],
      id: OUTSIDE,
      index: lessons.length + 1,
      title: "课外",
    });
  }
  for (const c of outside) {
    points.push({
      aliases: c.aliases,
      checkQuestions: [],
      definition: c.definition,
      id: c.id,
      kind: "concept",
      lessonId: OUTSIDE,
      name: c.name,
      sources: [],
      status: "auto",
    });
    // 课外概念没有检查题，算不上“会”：聊过就半亮（只在一次对话里出现过的，下面再调暗）
    lights[c.id] = "half";
    stars[c.id] = {
      aliases: c.aliases,
      definition: c.definition,
      evidence: recent(c.evidence.map((e) => ({ ...e, how: "chat" }))),
      id: c.id,
      kind: "outside",
      light: "half",
      merged: c.merged ?? [],
      name: c.name,
      related: [],
      where: "课外",
    };
  }

  // 回链（个人知识库第 3 步）：每条出处标上哪次对话、哪门课；同一次对话里都出现过的算“常一起出现”。
  // 课外概念只在一次对话里出现过的先暗着，再在别的对话里出现一次才亮（课内的亮度只看答题）
  const courseOf = new Map<string, string>();
  for (const state of input.states) {
    const name = input.courses.find((c) => c.courseId === state.courseId)?.name;
    for (const node of Object.values(state.nodes)) {
      for (const a of node.attempts) {
        if (name) {
          courseOf.set(a.sessionId, name);
        }
      }
    }
  }
  const all = Object.values(stars);
  const sessions = new Map(
    all.map((star) => [
      star.id,
      new Set(star.evidence.map((e) => e.sessionId).filter(Boolean)),
    ])
  );
  const related: StarMap["related"] = {};
  for (const star of all) {
    const mine = sessions.get(star.id) ?? new Set<string>();
    star.related = all
      .filter((o) => o.id !== star.id)
      .map((o) => ({
        id: o.id,
        n: [...(sessions.get(o.id) ?? [])].filter((x) => mine.has(x)).length,
      }))
      .filter((x) => x.n > 0)
      .toSorted((a, b) => b.n - a.n)
      .slice(0, MAX_RELATED)
      .map((x) => x.id);
    related[star.id] = star.related;
    if (star.kind === "outside" && mine.size < 2) {
      star.light = "gray";
      lights[star.id] = "gray";
    }
    star.evidence = star.evidence.slice(0, MAX_EVIDENCE).map((e) => ({
      ...e,
      chat: input.chats?.[e.sessionId],
      course: courseOf.get(e.sessionId),
    }));
  }

  return {
    catalog,
    graph: {
      builtAt: new Date(0).toISOString(),
      courseId: "me",
      edges,
      lessons,
      name: "我的星图",
      points,
    },
    lights,
    progress,
    related,
    stars,
  };
}

// “和另一个是同一个”的候选：别的课外概念都列，名字像的排前面；
// 课内知识点只列名字像的（并进去等于锚定，用户 2026-10-23 选“课内只看，课外能纠错”）
const MAX_CANDIDATES = 8;

export function mergeCandidates(
  map: Pick<StarMap, "stars" | "catalog">,
  id: string
): MergeTarget[] {
  const self = map.stars[id];
  if (self?.kind !== "outside") {
    return [];
  }
  const names = (s: MergeTarget) => [s.name, ...s.aliases];
  const alike = (s: MergeTarget) =>
    names(self).some((a) => names(s).some((b) => similar(a, b)));
  const outside = Object.values(map.stars).filter(
    (s) => s.kind === "outside" && s.id !== id
  );
  return [...outside, ...map.catalog.filter(alike)]
    .toSorted((a, b) => Number(alike(b)) - Number(alike(a)))
    .slice(0, MAX_CANDIDATES);
}
