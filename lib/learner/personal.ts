import type {
  ConceptChange,
  ConceptEvent,
  ConceptEventPayload,
  ConceptEventType,
  CourseGraph,
  PersonalConcept,
  PersonalGraph,
} from "@/lib/types";

// 个人知识库（个人知识库怎么建模·推荐组合）：
// - 身份表：每个课外概念一个固定编号 pc_N，带正名和别名，认人靠编号不靠名字；
// - 证据日志：提到、记错、合并、拆开都记成只追加的 ConceptEvent，个人图谱整份从日志算出来，
//   合错了拆开、算法改了重算，证据都不会丢。
// 课内知识点的掌握仍只认答题证据；学生顺口提到课程知识点，只在它的 id 上记一条“提到”

export function emptyPersonalGraph(studentId: string): PersonalGraph {
  return { concepts: [], courseMentions: {}, log: [], studentId };
}

export const isPersonalId = (id: string) => /^pc_\d+$/.test(id);

// ---- 名字比较：认人时先用字面相似找候选，最终由 Claude 判断 ----

// 小写，去掉空白和标点，括号里的注释保留（“外壳程序”也是线索）
export const norm = (name: string) =>
  name.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

function bigrams(s: string): string[] {
  const chars = [...s];
  return chars.length < 2 ? chars : chars.slice(1).map((c, i) => chars[i] + c);
}

// 一个包含另一个，或字符二元组的 Dice 系数 ≥ 0.5，就算像（假设）
export function similar(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!(x && y)) {
    return false;
  }
  if (x === y) {
    return true;
  }
  if (
    Math.min([...x].length, [...y].length) >= 2 &&
    (x.includes(y) || y.includes(x))
  ) {
    return true;
  }
  const bx = bigrams(x);
  const by = new Map<string, number>();
  for (const g of bigrams(y)) {
    by.set(g, (by.get(g) ?? 0) + 1);
  }
  let common = 0;
  for (const g of bx) {
    const n = by.get(g) ?? 0;
    if (n > 0) {
      common += 1;
      by.set(g, n - 1);
    }
  }
  return (2 * common) / (bx.length + bigrams(y).length) >= 0.5;
}

export type Candidate = { id: string; names: string[]; definition: string };

// 身份表里和这个叫法像的：已有课外概念（正名 + 别名）、课程知识点（名字 + 别名）
export function candidatesFor(
  name: string,
  pool: readonly Candidate[]
): Candidate[] {
  return pool.filter((c) => c.names.some((n) => similar(n, name)));
}

export function identityPool(
  personal: PersonalGraph,
  graphs: readonly CourseGraph[]
): Candidate[] {
  return [
    ...personal.concepts
      .filter((c) => c.status !== "invalidated")
      .map((c) => ({
        definition: c.definition,
        id: c.id,
        names: [c.name, ...c.aliases],
      })),
    ...graphs.flatMap((g) =>
      g.points.map((p) => ({
        definition: p.definition,
        id: p.id,
        names: [p.name, ...p.aliases],
      }))
    ),
  ];
}

// ---- 从日志算个人图谱 ----

// 没被拆开的合并：from → into
function activeMerges(events: readonly ConceptEvent[]): Map<string, string> {
  const undone = new Set(
    events
      .filter((e) => e.type === "split" && e.payload.mergeId)
      .map((e) => e.payload.mergeId)
  );
  const into = new Map<string, string>();
  for (const e of events) {
    if (e.type === "merge" && e.payload.from && !undone.has(e.id)) {
      into.set(e.payload.from, e.conceptId);
    }
  }
  return into;
}

function rootOf(id: string, into: ReadonlyMap<string, string>): string {
  let cur = id;
  const seen = new Set<string>();
  while (into.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = into.get(cur) ?? cur;
  }
  return cur;
}

export function personalFromEvents(
  studentId: string,
  events: readonly ConceptEvent[]
): PersonalGraph {
  const into = activeMerges(events);
  const concepts = new Map<string, PersonalConcept>();
  const courseMentions: PersonalGraph["courseMentions"] = {};
  const log: PersonalGraph["log"] = [];
  const seen = new Set<string>();
  // 每个编号自己第一次被提到时的叫法
  const ownName = new Map<string, string>();

  for (const e of events) {
    const { payload: p } = e;
    if (e.type === "mention" && !isPersonalId(e.conceptId)) {
      courseMentions[e.conceptId] = [
        ...(courseMentions[e.conceptId] ?? []),
        { at: e.at, quote: p.quote ?? "", sessionId: e.sessionId ?? "" },
      ];
      continue;
    }
    if (!isPersonalId(e.conceptId)) {
      continue;
    }
    const root = rootOf(e.conceptId, into);
    if (e.type === "mention") {
      if (!ownName.has(e.conceptId) && p.name?.trim()) {
        ownName.set(e.conceptId, p.name.trim());
      }
      const old = concepts.get(root);
      const evidence = {
        at: e.at,
        quote: p.quote ?? "",
        sessionId: e.sessionId ?? "",
      };
      const name = (p.name ?? "").trim();
      concepts.set(
        root,
        old
          ? {
              ...old,
              aliases:
                name &&
                !old.aliases
                  .concat(old.name)
                  .some((n) => norm(n) === norm(name))
                  ? [...old.aliases, name]
                  : old.aliases,
              definition: old.definition || (p.definition ?? ""),
              evidence: [...old.evidence, evidence],
              // 只升不降：说过“学过”就保留
              level:
                old.level === "claimed" ? "claimed" : (p.level ?? old.level),
              note: undefined,
              status: "unanchored",
            }
          : {
              aliases: [],
              createdAt: e.at,
              definition: p.definition ?? "",
              evidence: [evidence],
              id: root,
              level: p.level ?? "touched",
              name,
              status: "unanchored",
            }
      );
      log.push({
        at: e.at,
        conceptId: e.conceptId,
        op: seen.has(e.conceptId) ? "update" : "add",
        quote: p.quote ?? "",
        sessionId: e.sessionId ?? "",
      });
      seen.add(e.conceptId);
      continue;
    }
    if (e.type === "invalidate") {
      const old = concepts.get(root);
      if (old) {
        concepts.set(root, {
          ...old,
          note: p.reason,
          status: "invalidated",
        });
        log.push({
          at: e.at,
          conceptId: e.conceptId,
          op: "invalidate",
          quote: p.quote ?? p.reason ?? "",
          sessionId: e.sessionId ?? "",
        });
      }
    }
  }
  // 合并是“认错了人”的更正，对之前的记录也生效：被并掉的那个的叫法和证据都已算在并进去的概念上。
  // 正名用并进去的那个自己第一次的叫法，其余叫法都是别名
  for (const [root, c] of concepts) {
    const own = ownName.get(root) ?? c.name;
    const names = [c.name, ...c.aliases];
    concepts.set(root, {
      ...c,
      aliases: names.filter(
        (n, i) =>
          norm(n) !== norm(own) &&
          names.findIndex((m) => norm(m) === norm(n)) === i
      ),
      name: own,
    });
  }
  return {
    concepts: [...concepts.values()],
    courseMentions,
    log,
    studentId,
  };
}

// 下一个课外概念编号：用过的不复用
export function nextConceptSeq(events: readonly ConceptEvent[]): number {
  return Math.max(
    0,
    ...events
      .map((e) => e.conceptId)
      .filter(isPersonalId)
      .map((id) => Number(id.slice(3)))
  );
}

// 同一批写入的事件按顺序错开 1 毫秒，读回来时顺序不乱
export function stamp(
  drafts: readonly {
    conceptId: string;
    type: ConceptEventType;
    payload: ConceptEventPayload;
  }[],
  ctx: { studentId: string; sessionId: string | null; now: string },
  newId: () => string
): ConceptEvent[] {
  const t0 = new Date(ctx.now).getTime();
  return drafts.map((d, i) => ({
    ...d,
    at: new Date(t0 + i).toISOString(),
    id: newId(),
    sessionId: ctx.sessionId,
    studentId: ctx.studentId,
  }));
}

// 旧的 PersonalGraph 表（按名字认人的那版）第一次读时转成日志：每条出处一条“提到”，作废的补一条“记错”
export function eventsFromLegacy(
  legacy: PersonalGraph,
  newId: () => string
): ConceptEvent[] {
  const out: ConceptEvent[] = [];
  for (const c of legacy.concepts) {
    c.evidence.forEach((ev, i) => {
      out.push({
        at: ev.at,
        conceptId: c.id,
        id: newId(),
        payload: {
          by: "review",
          definition: c.definition,
          level: c.level,
          name: c.name,
          quote: ev.quote,
        },
        sessionId: ev.sessionId || null,
        studentId: legacy.studentId,
        type: "mention",
      });
      if (i === c.evidence.length - 1 && c.status === "invalidated") {
        out.push({
          at: new Date(new Date(ev.at).getTime() + 1).toISOString(),
          conceptId: c.id,
          id: newId(),
          payload: { by: "review", reason: c.note },
          sessionId: null,
          studentId: legacy.studentId,
          type: "invalidate",
        });
      }
    });
  }
  return out.toSorted((a, b) => a.at.localeCompare(b.at));
}

// ---- 复盘后“先认人再记账” ----

// 学生顺口提到课程知识点时记不记“提到”（2026-10-23 决策卡推荐项，等用户确认）
export const RECORD_COURSE_MENTIONS = true;

export type IdentityQuestion = {
  index: number; // 第几条变更
  name: string;
  definition: string;
  quote: string;
  // 已有的课外概念、课程知识点；"#j" 是这次复盘里第 j 条提到的东西
  candidates: Candidate[];
};

const mentions = (c: ConceptChange) => c.op === "add" || c.op === "update";

// 哪些提到要问 Claude“是哪个”：复核已经给了有效编号的直接用；字面上没有像的直接算新的；
// 其余列出候选（含同一次复盘里前面提到的），一次问完
export function identityQuestions(
  changes: readonly ConceptChange[],
  pool: readonly Candidate[]
): IdentityQuestion[] {
  const known = new Set(pool.map((c) => c.id));
  const questions: IdentityQuestion[] = [];
  changes.forEach((c, i) => {
    if (!mentions(c) || known.has(c.sameAs)) {
      return;
    }
    const earlier: Candidate[] = changes
      .slice(0, i)
      .map((d, j) => ({ d, j }))
      .filter(({ d }) => mentions(d) && similar(d.name, c.name))
      .map(({ d, j }) => ({
        definition: d.definition,
        id: `#${j}`,
        names: [d.name],
      }));
    const candidates = [...candidatesFor(c.name, pool), ...earlier];
    if (candidates.length > 0) {
      questions.push({
        candidates,
        definition: c.definition,
        index: i,
        name: c.name,
        quote: c.quote,
      });
    }
  });
  return questions;
}

// 认完人，变成要追加的日志。answers：第几条 → 候选 id 或 "new"；答案不在候选里按新的算
export function identityEvents(
  changes: readonly ConceptChange[],
  pool: readonly Candidate[],
  questions: readonly IdentityQuestion[],
  answers: ReadonlyMap<number, string>,
  startSeq: number
): {
  conceptId: string;
  type: ConceptEventType;
  payload: ConceptEventPayload;
}[] {
  const known = new Set(pool.map((c) => c.id));
  const asked = new Map(questions.map((q) => [q.index, q]));
  const resolved = new Map<number, string>();
  let seq = startSeq;
  const drafts: {
    conceptId: string;
    type: ConceptEventType;
    payload: ConceptEventPayload;
  }[] = [];
  changes.forEach((c, i) => {
    if (c.op === "invalidate") {
      const target = known.has(c.sameAs)
        ? c.sameAs
        : pool.find((p) => p.names.some((n) => norm(n) === norm(c.name)))?.id;
      if (target && isPersonalId(target)) {
        drafts.push({
          conceptId: target,
          payload: { by: "review", quote: c.quote, reason: c.reason },
          type: "invalidate",
        });
      }
      return;
    }
    let id: string | undefined;
    if (known.has(c.sameAs)) {
      id = c.sameAs;
    } else {
      const q = asked.get(i);
      const answer = answers.get(i);
      if (q && answer && q.candidates.some((cand) => cand.id === answer)) {
        id = answer.startsWith("#")
          ? resolved.get(Number(answer.slice(1)))
          : answer;
      }
    }
    if (!id) {
      seq += 1;
      id = `pc_${seq}`;
    }
    resolved.set(i, id);
    if (!isPersonalId(id) && !RECORD_COURSE_MENTIONS) {
      return;
    }
    drafts.push({
      conceptId: id,
      payload: {
        by: "review",
        definition: c.definition,
        level: c.level,
        name: c.name.trim(),
        quote: c.quote,
      },
      type: "mention",
    });
  });
  return drafts;
}

// 学生纠错（下一个 PR 接界面）：“这两个是同一个”→ 合并；“记错了”→ 作废。都记成学生给的证据
export function mergeDraft(from: string, into: string) {
  return {
    conceptId: into,
    payload: { by: "student" as const, from },
    type: "merge" as const,
  };
}

export function splitDraft(mergeEvent: ConceptEvent) {
  return {
    conceptId: mergeEvent.conceptId,
    payload: { by: "student" as const, mergeId: mergeEvent.id },
    type: "split" as const,
  };
}

export function invalidateDraft(conceptId: string, reason: string) {
  return {
    conceptId,
    payload: { by: "student" as const, reason },
    type: "invalidate" as const,
  };
}
