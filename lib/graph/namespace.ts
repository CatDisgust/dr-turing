import type { CourseGraph } from "@/lib/types";

// 知识点编号带上课 id（kp_l2_3 → kp_os101-hkc7_l2_3）。
// 抽取时编号只按“第几课第几个”起，每门课都从 kp_l1_1 开始；我的星图、提到记录、掌握度都按编号存，
// 学生学两门课时同号的点会互相覆盖。COMP5348 的旧编号不动（演示数据和视频都靠它），已经带上的也不再加
export function namespacePoints(graph: CourseGraph): CourseGraph {
  if (graph.courseId === "comp5348") {
    return graph;
  }
  const prefix = `kp_${graph.courseId}_`;
  const rename = (id: string) =>
    id.startsWith(prefix) ? id : `${prefix}${id.replace(/^kp_/, "")}`;
  return {
    ...graph,
    edges: graph.edges.map((e) => ({
      ...e,
      from: rename(e.from),
      to: rename(e.to),
    })),
    points: graph.points.map((p) => ({ ...p, id: rename(p.id) })),
  };
}
