import type {
  Attempt,
  KnowledgePoint,
  TeachingNote,
  TutorPlan,
} from "@/lib/types";
import type { ArmOutcome } from "./preference";

// 教学笔记（学生建模方案 E）：Claude 在复核时把“猜错了的地方”写成一句话规律，
// 每条都写明在什么讲法下、预计会怎样。检验全由代码做：之后每遇到一轮符合条件的讲解，
// 结果对上就 hits + 1，对不上就 misses + 1。笔记只影响怎么讲，不影响他会什么

// 最多留几条有效笔记（参照 Hermes 的上限记忆）
export const MAX_NOTES = 8;
// hits 到这个数才放进导师提示词
export const TRUSTED_HITS = 2;
// misses 比 hits 多这么多就自动删
export const DROP_MARGIN = 2;
// 已删的笔记留几条备查
const KEEP_INACTIVE = 16;

type Kinds = Readonly<Record<string, KnowledgePoint["kind"]>>;

function matches(note: TeachingNote, outcome: ArmOutcome, kinds: Kinds) {
  const [representation, order] = outcome.arm.split(":");
  const { when } = note;
  return (
    (!when.representation || when.representation === representation) &&
    (!when.order || when.order === order) &&
    (!when.kind || when.kind === kinds[outcome.kpId])
  );
}

// 这一轮的结果对不对得上 expect；学得好没有结果（后面没做题）时不算
function verdict(note: TeachingNote, outcome: ArmOutcome): boolean | null {
  switch (note.expect) {
    case "learn_good":
      return outcome.learn ?? null;
    case "learn_bad":
      return outcome.learn === undefined ? null : !outcome.learn;
    case "feel_good":
      return outcome.feel;
    case "feel_bad":
      return !outcome.feel;
    default:
      return null;
  }
}

// 从原始记录重算每条笔记的 hits、misses（方案 F：能重算的都重算）。
// 只看写下这条笔记之后的讲解；删掉的（不管谁删的）不再检验
export function checkNotes(
  notes: readonly TeachingNote[],
  outcomes: readonly ArmOutcome[],
  kinds: Kinds
): TeachingNote[] {
  return notes.map((note) => {
    if (note.status !== "active") {
      return note;
    }
    let hits = 0;
    let misses = 0;
    for (const o of outcomes) {
      if (o.at <= note.createdAt || !matches(note, o, kinds)) {
        continue;
      }
      const ok = verdict(note, o);
      if (ok === true) {
        hits += 1;
      } else if (ok === false) {
        misses += 1;
      }
    }
    return {
      ...note,
      hits,
      misses,
      status: misses - hits >= DROP_MARGIN ? "dropped" : "active",
    };
  });
}

export const activeNotes = (notes: readonly TeachingNote[]) =>
  notes.filter((n) => n.status === "active");

export const trustedNotes = (notes: readonly TeachingNote[]) =>
  activeNotes(notes).filter((n) => n.hits >= TRUSTED_HITS);

// 这一轮的讲法用得上哪些检验过的笔记
export function notesFor(
  notes: readonly TeachingNote[],
  plan: Pick<TutorPlan, "representation" | "order" | "target_kc">,
  kind: KnowledgePoint["kind"] | undefined
): TeachingNote[] {
  return notes.filter(
    (n) =>
      n.status === "active" &&
      n.hits >= TRUSTED_HITS &&
      (!n.when.representation ||
        n.when.representation === plan.representation) &&
      (!n.when.order || n.when.order === plan.order) &&
      (!n.when.kind || n.when.kind === kind)
  );
}

// ---- 猜错了什么：交给 Claude 写笔记的材料 ----

// 同一种讲法下猜错累计到这么多次，才交给 Claude 总结；一次可能只是偶然（用户 2026-10-23）。
// demo 可以调成 1（环境变量 NOTES_MIN_MISSES），正式版不能低于 2
export const MIN_MISSES = 2;

// arm 是猜错时用的讲法：“感受”就是那轮讲解的讲法；“学得”是答这道题之前、同一个点上最近一次讲解的讲法，
// 之前没讲过就是 null
export type Miss = { sessionId: string; arm: string | null; kpId: string } & (
  | {
      kind: "learn";
      attemptId: string;
      predicted: number;
      correct: boolean;
      quote: string;
    }
  | {
      kind: "feel";
      messageId: string;
      predicted: number;
      feel: boolean;
    }
);

export const missId = (m: Miss) =>
  m.kind === "learn" ? m.attemptId : m.messageId;

// 全部记录里猜错的地方。答对概率 ≥ 0.5 算猜他会答对；预计喜欢 ≥ 0.5 算猜他会觉得舒服
export function mispredictions(
  rows: readonly { attempt: Attempt; kpId: string }[],
  outcomes: readonly ArmOutcome[]
): Miss[] {
  const learn: Miss[] = rows
    .filter(
      ({ attempt: a }) =>
        a.prediction !== undefined &&
        !a.hinted &&
        a.correct !== undefined &&
        a.prediction.pCorrect >= 0.5 !== a.correct
    )
    .map(({ attempt: a, kpId }) => ({
      arm:
        outcomes.findLast((o) => o.kpId === kpId && o.at < a.at)?.arm ?? null,
      attemptId: a.id,
      correct: a.correct === true,
      kind: "learn",
      kpId,
      predicted: a.prediction?.pCorrect ?? 0,
      quote: a.quote,
      sessionId: a.sessionId,
    }));
  const feel: Miss[] = outcomes
    .filter((o) => o.expectLike !== undefined && o.expectLike >= 0.5 !== o.feel)
    .map((o) => ({
      arm: o.arm,
      feel: o.feel,
      kind: "feel",
      kpId: o.kpId,
      messageId: o.messageId,
      predicted: o.expectLike ?? 0,
      sessionId: o.chatId,
    }));
  return [...learn, ...feel];
}

// 这次结束学习该不该写笔记、拿哪些材料：还没被任何笔记引用过的猜错先攒着，
// 某种讲法下攒够 min 次、而且这次会话里又猜错了，才把这一组交给 Claude
export function readyMisses(
  misses: readonly Miss[],
  notes: readonly TeachingNote[],
  sessionId: string,
  min: number = MIN_MISSES
): Miss[] {
  const used = new Set(notes.flatMap((n) => n.evidence));
  const groups = new Map<string, Miss[]>();
  for (const m of misses) {
    if (used.has(missId(m))) {
      continue;
    }
    const key = m.arm ?? "none";
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.values()]
    .filter((g) => g.length >= min && g.some((m) => m.sessionId === sessionId))
    .flat();
}

// ---- 把 Claude 给的增删改落到笔记上 ----

export type NoteOp = {
  op: "add" | "edit" | "delete";
  id: string; // edit、delete 填已有笔记的 id；add 留空
  text: string;
  when: TeachingNote["when"];
  expect: TeachingNote["expect"];
  evidence: string[];
};

// 每个操作都必须引用给过的证据 id，没引用到就不采纳；有效笔记最多 MAX_NOTES 条。
// edit 等于换一条新笔记：重新从零检验
export function applyNoteOps(
  notes: readonly TeachingNote[],
  ops: readonly NoteOp[],
  evidenceIds: ReadonlySet<string>,
  now: string,
  newId: () => string
): TeachingNote[] {
  let next = [...notes];
  for (const op of ops) {
    const evidence = op.evidence.filter((id) => evidenceIds.has(id));
    if (evidence.length === 0) {
      continue;
    }
    const target = next.find((n) => n.id === op.id && n.status === "active");
    if (op.op === "delete") {
      if (target) {
        next = next.map((n) =>
          n === target
            ? {
                ...n,
                evidence: [...n.evidence, ...evidence],
                status: "deleted",
              }
            : n
        );
      }
      continue;
    }
    if (op.op === "edit" && !target) {
      continue;
    }
    if (op.op === "add" && activeNotes(next).length >= MAX_NOTES) {
      continue;
    }
    const fresh: TeachingNote = {
      createdAt: now,
      evidence: [...(target?.evidence ?? []), ...evidence],
      expect: op.expect,
      hits: 0,
      id: newId(),
      misses: 0,
      status: "active",
      text: op.text.trim(),
      when: op.when,
    };
    next = target
      ? [
          ...next.map((n) =>
            n === target ? { ...n, status: "deleted" as const } : n
          ),
          fresh,
        ]
      : [...next, fresh];
  }
  const inactive = next.filter((n) => n.status !== "active");
  return [...activeNotes(next), ...inactive.slice(-KEEP_INACTIVE)];
}
