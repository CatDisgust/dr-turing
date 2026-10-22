import { z } from "zod";
import type { CourseGraph, KnowledgePoint } from "@/lib/types";
import { cleanEdges } from "./cycles";

// 学生审阅图谱的三种操作，都是纯函数：输入旧图，返回新图。
// 动过的节点标成 reviewed。

export const reviewOpSchema = z.discriminatedUnion("op", [
  // 把 drop 并进 keep：drop 的名字、别名、出处、检查题、误解、边都归到 keep
  z.object({ drop: z.string(), keep: z.string(), op: z.literal("merge") }),
  z.object({
    id: z.string(),
    name: z.string().min(1),
    op: z.literal("rename"),
  }),
  z.object({ id: z.string(), op: z.literal("delete") }),
]);

export type ReviewOp = z.infer<typeof reviewOpSchema>;

const unique = (items: string[]) => [...new Set(items.filter(Boolean))];

function mergePoints(
  graph: CourseGraph,
  keepId: string,
  dropId: string
): CourseGraph {
  const keep = graph.points.find((p) => p.id === keepId);
  const drop = graph.points.find((p) => p.id === dropId);
  if (!(keep && drop) || keepId === dropId) {
    throw new Error("要合并的两个知识点不存在或是同一个");
  }

  const merged: KnowledgePoint = {
    ...keep,
    aliases: unique([...keep.aliases, drop.name, ...drop.aliases]).filter(
      (alias) => alias !== keep.name
    ),
    checkQuestions: unique([...keep.checkQuestions, ...drop.checkQuestions]),
    sources: [...keep.sources, ...drop.sources],
    status: "reviewed",
  };

  // 指向 drop 的边改指 keep；改完可能出现自环、重复或环，交给 cleanEdges 去掉
  const rewired = graph.edges.map((edge) => ({
    ...edge,
    from: edge.from === dropId ? keepId : edge.from,
    to: edge.to === dropId ? keepId : edge.to,
  }));
  const points = graph.points
    .filter((p) => p.id !== dropId)
    .map((p) => (p.id === keepId ? merged : p));

  return {
    ...graph,
    edges: cleanEdges(rewired, new Set(points.map((p) => p.id))).edges,
    points,
  };
}

export function applyReview(graph: CourseGraph, op: ReviewOp): CourseGraph {
  if (op.op === "merge") {
    return mergePoints(graph, op.keep, op.drop);
  }
  if (!graph.points.some((p) => p.id === op.id)) {
    throw new Error("知识点不存在");
  }
  if (op.op === "rename") {
    return {
      ...graph,
      points: graph.points.map((p) =>
        p.id === op.id
          ? {
              ...p,
              // 旧名字留作别名，学生用旧叫法问也能找到
              aliases: unique([p.name, ...p.aliases]).filter(
                (alias) => alias !== op.name.trim()
              ),
              name: op.name.trim(),
              status: "reviewed",
            }
          : p
      ),
    };
  }
  return {
    ...graph,
    edges: graph.edges.filter((e) => e.from !== op.id && e.to !== op.id),
    points: graph.points.filter((p) => p.id !== op.id),
  };
}
