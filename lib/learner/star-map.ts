import type {
  ConceptLink,
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
  // 意思上有关系的（复核时 Claude 判断，学生可以说连错了）。label 是从这颗星看过去的说法
  links: { to: string; name: string; label: string; linkId: string }[];
};

// 选中一颗星时额外画的线：link 是意思上的关系（实线，带说明），together 是一起出现（虚线）
export type ExtraEdge = {
  to: string;
  kind: "link" | "together";
  label?: string;
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
  related: Record<string, ExtraEdge[]>;
};

// 一颗星最多列几条出处，新的在前
const MAX_EVIDENCE = 8;
// “常一起出现”最多列几个
const MAX_RELATED = 5;

// 新的在前；同一次对话里同一句原话只留一条（复核一次可能用两个叫法各记一次）
const recent = (items: StarEvidence[]) =>
  items
    .toSorted((a, b) => b.at.localeCompare(a.at))
    .filter(
      (e, i, all) =>
        all.findIndex(
          (x) => x.sessionId === e.sessionId && x.quote === e.quote
        ) === i
    );

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
      // 编号带课 id 之前生成的课，和别的课可能撞号：先到先得，别把前一门课的星盖掉
      if (stars[p.id]) {
        return false;
      }
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
        links: [],
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
      links: [],
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
  // 意思上的关系：两头都在图上（或在课程里）才列；线只画到图上有的星
  const nameOf = (id: string) =>
    stars[id]?.name ?? catalog.find((c) => c.id === id)?.name;
  const say = (how: ConceptLink["how"], other: string, outgoing: boolean) => {
    if (how === "part_of") {
      return outgoing ? `是「${other}」的一部分` : `「${other}」是它的一部分`;
    }
    if (how === "prereq") {
      return outgoing ? `要先懂「${other}」` : `是学「${other}」之前要懂的`;
    }
    return `和「${other}」有关`;
  };
  for (const link of input.personal.links ?? []) {
    const fromName = nameOf(link.from);
    const toName = nameOf(link.to);
    if (!(fromName && toName)) {
      continue;
    }
    stars[link.from]?.links.push({
      label: say(link.how, toName, true),
      linkId: link.id,
      name: toName,
      to: link.to,
    });
    stars[link.to]?.links.push({
      label: say(link.how, fromName, false),
      linkId: link.id,
      name: fromName,
      to: link.from,
    });
  }

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
    related[star.id] = [
      ...star.links
        .filter((l) => stars[l.to])
        .map((l) => ({
          kind: "link" as const,
          label: l.label.replace(/「|」/g, ""),
          to: l.to,
        })),
      ...star.related
        .filter((id) => !star.links.some((l) => l.to === id))
        .map((to) => ({ kind: "together" as const, to })),
    ];
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

// 课内每门课先收成一团（用户 2026-10-23 选“课内每门课先收成一团”）：没展开的课只画一颗星云，
// 写着全亮几个、半亮几个，点它才展开成一颗颗星；课外概念一直单独画
export const CLUSTER = "cluster:";

export function collapseCourses(
  map: StarMap,
  expanded: ReadonlySet<string>
): Pick<StarMap, "graph" | "lights" | "progress" | "related"> {
  const folded = new Set(
    map.graph.lessons
      .filter((l) => l.id !== OUTSIDE && !expanded.has(l.id))
      .map((l) => l.id)
  );
  if (folded.size === 0) {
    return map;
  }
  // 被收起的星 → 它那团星云
  const home = new Map<string, string>();
  for (const p of map.graph.points) {
    if (folded.has(p.lessonId)) {
      home.set(p.id, `${CLUSTER}${p.lessonId}`);
    }
  }
  const lights = { ...map.lights };
  const clusters = map.graph.lessons
    .filter((l) => folded.has(l.id))
    .map((l) => {
      const ids = map.graph.points
        .filter((p) => p.lessonId === l.id)
        .map((p) => p.id);
      const full = ids.filter((x) => map.lights[x] === "full").length;
      const half = ids.filter((x) => map.lights[x] === "half").length;
      const id = `${CLUSTER}${l.id}`;
      lights[id] = full > 0 ? "full" : half > 0 ? "half" : "gray";
      return {
        // 星云的“定义”就是这门课点亮了多少，块标题也用它
        aliases: [],
        checkQuestions: [],
        definition: `全亮 ${full} · 半亮 ${half} / ${ids.length}`,
        id,
        kind: "concept" as const,
        lessonId: l.id,
        name: `点开看 ${ids.length} 个知识点`,
        sources: [],
        status: "auto" as const,
      };
    });
  const related: StarMap["related"] = {};
  for (const [id, others] of Object.entries(map.related)) {
    if (home.has(id)) {
      continue;
    }
    // 连到收起的星就连到它那团星云，同一团只连一条
    const seen = new Set<string>();
    related[id] = others.flatMap((o) => {
      const to = home.get(o.to) ?? o.to;
      if (seen.has(to)) {
        return [];
      }
      seen.add(to);
      return [{ ...o, to }];
    });
  }
  const counts = new Map(
    clusters.map((c) => [c.lessonId, c.definition] as const)
  );
  return {
    graph: {
      ...map.graph,
      edges: map.graph.edges.filter(
        (e) => !(home.has(e.from) || home.has(e.to))
      ),
      lessons: map.graph.lessons.map((l) =>
        counts.has(l.id)
          ? { ...l, title: `${l.title} · ${counts.get(l.id)}` }
          : l
      ),
      points: [...clusters, ...map.graph.points.filter((p) => !home.has(p.id))],
    },
    lights,
    progress: map.progress,
    related,
  };
}

// 我的星图分课程看（用户 2026-10-24）：全部 / 每门课 / 课外。
// 只收起图上画哪些星；星的详情、能并进哪个知识点还按全部的来
export const ALL = "all";

export function starScopes(
  map: Pick<StarMap, "graph">
): { id: string; label: string; count: number }[] {
  const count = (id: string) =>
    map.graph.points.filter((p) => p.lessonId === id).length;
  return [
    { count: map.graph.points.length, id: ALL, label: "全部" },
    ...map.graph.lessons.map((l) => ({
      count: count(l.id),
      id: l.id,
      label: l.title,
    })),
  ];
}

export function scopeStarMap(map: StarMap, scope: string): StarMap {
  if (scope === ALL || !map.graph.lessons.some((l) => l.id === scope)) {
    return map;
  }
  const keep = new Set(
    map.graph.points.filter((p) => p.lessonId === scope).map((p) => p.id)
  );
  return {
    ...map,
    graph: {
      ...map.graph,
      edges: map.graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
      lessons: map.graph.lessons.filter((l) => l.id === scope),
      points: map.graph.points.filter((p) => keep.has(p.id)),
    },
    related: Object.fromEntries(
      Object.entries(map.related)
        .filter(([id]) => keep.has(id))
        .map(([id, others]) => [id, others.filter((o) => keep.has(o.to))])
    ),
  };
}
