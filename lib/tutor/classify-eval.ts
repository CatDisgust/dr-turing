import type { KnowledgePoint } from "@/lib/types";

// 归类评测的判分：归到的点，名称或别名包含任一个可接受的片段就算对；
// accept 为 null 的题应当归为 none。图谱重建后 id 会变，所以按名称判，不按 id

export type ClassifyCase = { question: string; accept: string[] | null };

const norm = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function isAccepted(
  point: Pick<KnowledgePoint, "name" | "aliases"> | null,
  accept: string[] | null
): boolean {
  if (accept === null) {
    return point === null;
  }
  if (point === null) {
    return false;
  }
  const names = [point.name, ...point.aliases].map(norm);
  return accept.some((term) => names.some((name) => name.includes(norm(term))));
}
