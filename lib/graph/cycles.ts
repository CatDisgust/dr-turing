import type { Edge } from "@/lib/types";

// 纯函数：去掉指向不存在节点的、自环、重复的边；prereq 和 part_of 各自不能成环，
// 按给出的顺序加边，哪条会造成环就丢哪条。
// 模型常把同一对点既标“属于”又标“先修”（总概念 → 子概念），两条互相打架，只留“属于”
export function cleanEdges(
  edges: Edge[],
  ids: Set<string>
): { edges: Edge[]; dropped: { edge: Edge; reason: string }[] } {
  const kept: Edge[] = [];
  const dropped: { edge: Edge; reason: string }[] = [];
  const seen = new Set<string>();
  const pair = (a: string, b: string) => [a, b].sort().join("|");
  const partOfPairs = new Set(
    edges.filter((e) => e.type === "part_of").map((e) => pair(e.from, e.to))
  );

  for (const edge of edges) {
    const key =
      edge.type === "confusable"
        ? `${edge.type}:${[edge.from, edge.to].sort().join("|")}`
        : `${edge.type}:${edge.from}|${edge.to}`;
    if (!(ids.has(edge.from) && ids.has(edge.to))) {
      dropped.push({ edge, reason: "节点不存在" });
    } else if (edge.from === edge.to) {
      dropped.push({ edge, reason: "自环" });
    } else if (
      edge.type === "prereq" &&
      partOfPairs.has(pair(edge.from, edge.to))
    ) {
      dropped.push({ edge, reason: "和属于边重复" });
    } else if (seen.has(key)) {
      dropped.push({ edge, reason: "重复" });
    } else if (
      edge.type !== "confusable" &&
      reaches(kept, edge.type, edge.to, edge.from)
    ) {
      dropped.push({ edge, reason: "会成环" });
    } else {
      kept.push(edge);
      seen.add(key);
    }
  }
  return { dropped, edges: kept };
}

// 沿同类型的边从 start 能不能走到 goal
function reaches(
  edges: Edge[],
  type: Edge["type"],
  start: string,
  goal: string
): boolean {
  const stack = [start];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop() as string;
    if (node === goal) {
      return true;
    }
    if (visited.has(node)) {
      continue;
    }
    visited.add(node);
    for (const edge of edges) {
      if (edge.type === type && edge.from === node) {
        stack.push(edge.to);
      }
    }
  }
  return false;
}

// 纯函数：图里还有没有环（给打分用）
export function hasCycle(edges: Edge[], type: Edge["type"]): boolean {
  return edges.some(
    (edge) => edge.type === type && reaches(edges, type, edge.to, edge.from)
  );
}
