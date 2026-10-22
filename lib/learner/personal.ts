import type {
  ConceptChange,
  CourseGraph,
  PersonalConcept,
  PersonalGraph,
} from "@/lib/types";

// 个人图谱的课外概念：复核给出新增 / 更新 / 作废，这里按规则落地。
// 对得上课程知识点的不建节点（课内只认答题证据）；名字一样的按同一个处理，防止重复

export function emptyPersonalGraph(studentId: string): PersonalGraph {
  return { concepts: [], log: [], studentId };
}

const norm = (name: string) => name.trim().toLowerCase().replace(/\s+/g, "");

export function applyConceptChanges(
  personal: PersonalGraph,
  graphs: CourseGraph[],
  changes: ConceptChange[],
  sessionId: string,
  now: string
): PersonalGraph {
  const courseIds = new Set(graphs.flatMap((g) => g.points.map((p) => p.id)));
  const courseNames = new Set(
    graphs.flatMap((g) =>
      g.points.flatMap((p) => [p.name, ...p.aliases]).map(norm)
    )
  );
  const concepts = [...personal.concepts];
  const log = [...personal.log];
  // 删过的 id 不复用
  let seq = Math.max(
    0,
    ...concepts.map((c) => Number(c.id.replace("pc_", "")) || 0),
    ...log.map((l) => Number(l.conceptId.replace("pc_", "")) || 0)
  );

  for (const change of changes) {
    if (courseIds.has(change.sameAs) || courseNames.has(norm(change.name))) {
      continue;
    }
    const index = concepts.findIndex(
      (c) => c.id === change.sameAs || norm(c.name) === norm(change.name)
    );
    const evidence = { at: now, quote: change.quote, sessionId };

    if (change.op === "invalidate") {
      if (index >= 0) {
        concepts[index] = {
          ...concepts[index],
          note: change.reason,
          status: "invalidated",
        };
        log.push({
          at: now,
          conceptId: concepts[index].id,
          op: "invalidate",
          quote: change.quote,
          sessionId,
        });
      }
      continue;
    }

    if (index >= 0) {
      const old = concepts[index];
      concepts[index] = {
        ...old,
        evidence: [...old.evidence, evidence],
        // 只升不降：说过“学过”就保留，直到被作废
        level: old.level === "claimed" ? "claimed" : change.level,
        status: "unanchored",
      };
      log.push({
        at: now,
        conceptId: old.id,
        op: "update",
        quote: change.quote,
        sessionId,
      });
      continue;
    }

    seq += 1;
    const concept: PersonalConcept = {
      createdAt: now,
      definition: change.definition,
      evidence: [evidence],
      id: `pc_${seq}`,
      level: change.level,
      name: change.name.trim(),
      status: "unanchored",
    };
    concepts.push(concept);
    log.push({
      at: now,
      conceptId: concept.id,
      op: "add",
      quote: change.quote,
      sessionId,
    });
  }
  return { ...personal, concepts, log };
}

// 学生自己删掉一个课外概念：真删，日志里记一笔
export function removeConcept(
  personal: PersonalGraph,
  conceptId: string,
  now: string
): PersonalGraph {
  const concept = personal.concepts.find((c) => c.id === conceptId);
  if (!concept) {
    return personal;
  }
  return {
    ...personal,
    concepts: personal.concepts.filter((c) => c.id !== conceptId),
    log: [
      ...personal.log,
      {
        at: now,
        conceptId,
        op: "invalidate",
        quote: "学生自己删掉",
        sessionId: "",
      },
    ],
  };
}
