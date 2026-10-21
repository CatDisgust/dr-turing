import type { CourseGraph, KnowledgePoint } from "@/lib/types";
import { hasCycle } from "./cycles";

// graph-score：拿手写金标准给图谱打分。纯函数、不调模型，结果可复现；
// 规则粗，最后还要人看一眼 missing 和 duplicates。

export type GoldList = {
  lessons: {
    index: number;
    points: { name: string; aliases: string[]; pages: number[] }[];
  }[];
};

export type GraphScore = {
  coverage: number;
  covered: {
    lesson: number;
    gold: string;
    by: "term" | "page";
    node: string;
  }[];
  missing: { lesson: number; gold: string }[];
  duplicates: [string, string][];
  cycles: { prereq: boolean; part_of: boolean };
  nodes: number;
  edges: Record<string, number>;
};

// 只留字母、数字和汉字，大小写不分
const norm = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// 两个叫法算同一个：完全相等，或较短的至少 6 个字符且被另一个包含
function sameTerm(a: string, b: string): boolean {
  if (!(a && b)) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.length >= 6 && long.includes(short);
}

const terms = (point: { name: string; aliases: string[] }) =>
  [point.name, ...point.aliases].map(norm).filter(Boolean);

export function scoreGraph(graph: CourseGraph, gold: GoldList): GraphScore {
  const covered: GraphScore["covered"] = [];
  const missing: GraphScore["missing"] = [];

  for (const lesson of gold.lessons) {
    const lessonId = `l${lesson.index}`;
    const inLesson = graph.points.filter((p) =>
      p.sources.some((s) => s.lessonId === lessonId)
    );
    for (const goldPoint of lesson.points) {
      const goldTerms = terms(goldPoint);
      const byTerm = inLesson.find((p) =>
        terms(p).some((t) => goldTerms.some((g) => sameTerm(t, g)))
      );
      const byPage = inLesson.find((p) =>
        p.sources.some(
          (s) => s.lessonId === lessonId && goldPoint.pages.includes(s.page)
        )
      );
      const node = byTerm ?? byPage;
      if (node) {
        covered.push({
          by: byTerm ? "term" : "page",
          gold: goldPoint.name,
          lesson: lesson.index,
          node: node.id,
        });
      } else {
        missing.push({ gold: goldPoint.name, lesson: lesson.index });
      }
    }
  }

  // 重复节点：名字或第一个别名（多半是课件原词）完全相同。
  // 不用包含关系：“质量属性”和“质量属性的精确化描述”不是重复
  const key = (p: KnowledgePoint) => [p.name, p.aliases[0] ?? ""].map(norm);
  const duplicates: [string, string][] = [];
  graph.points.forEach((a, i) => {
    for (const b of graph.points.slice(i + 1)) {
      if (key(a).some((x) => x && key(b).includes(x))) {
        duplicates.push([a.id, b.id]);
      }
    }
  });

  const edges: Record<string, number> = {};
  for (const edge of graph.edges) {
    edges[edge.type] = (edges[edge.type] ?? 0) + 1;
  }

  const total = covered.length + missing.length;
  return {
    coverage: total > 0 ? covered.length / total : 0,
    covered,
    cycles: {
      part_of: hasCycle(graph.edges, "part_of"),
      prereq: hasCycle(graph.edges, "prereq"),
    },
    duplicates,
    edges,
    missing,
    nodes: graph.points.length,
  };
}
