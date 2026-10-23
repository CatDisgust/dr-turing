import { describe, expect, it } from "vitest";
import type { Attempt, TeachingNote } from "@/lib/types";
import {
  applyNoteOps,
  checkNotes,
  MAX_NOTES,
  mispredictions,
  type NoteOp,
  notesFor,
  readyMisses,
  trustedNotes,
} from "../notes";
import type { ArmOutcome } from "../preference";

// 小明的一条笔记：“先讲定义他会难受”
const note: TeachingNote = {
  createdAt: "2026-10-23T10:00:00.000Z",
  evidence: ["m0"],
  expect: "feel_bad",
  hits: 0,
  id: "n1",
  misses: 0,
  status: "active",
  text: "他要先看例子才能接受定义",
  when: { order: "definition_first" },
};

const outcome = (over: Partial<ArmOutcome>): ArmOutcome => ({
  arm: "code:definition_first",
  at: "2026-10-23T11:00:00.000Z",
  chatId: "c2",
  feel: false,
  kpId: "kp_a",
  messageId: "m1",
  ...over,
});

const kinds = { kp_a: "concept", kp_b: "procedure" } as const;

describe("checkNotes", () => {
  it("写下之后、符合条件的讲解才检验：对上 hits，对不上 misses", () => {
    const [checked] = checkNotes(
      [note],
      [
        outcome({ at: "2026-10-23T09:00:00.000Z" }), // 写笔记之前，不算
        outcome({ messageId: "m1" }), // 先定义、难受：对上
        outcome({ feel: true, messageId: "m2" }), // 先定义、舒服：对不上
        outcome({ arm: "code:example_first", messageId: "m3" }), // 先例子：不符合条件
      ],
      kinds
    );
    expect([checked.hits, checked.misses, checked.status]).toEqual([
      1,
      1,
      "active",
    ]);
  });

  it("misses 比 hits 多 2 次就自动删，删了不再复活", () => {
    const [dropped] = checkNotes(
      [note],
      [outcome({ feel: true }), outcome({ feel: true, messageId: "m2" })],
      kinds
    );
    expect(dropped.status).toBe("dropped");
    const [still] = checkNotes(
      [dropped],
      [outcome({}), outcome({ messageId: "m2" }), outcome({ messageId: "m3" })],
      kinds
    );
    expect(still.status).toBe("dropped");
  });

  it("学得好类笔记只看后面有题的讲解；kind 限定知识点类型", () => {
    const learnNote: TeachingNote = {
      ...note,
      expect: "learn_good",
      when: { kind: "procedure", representation: "code" },
    };
    const [checked] = checkNotes(
      [learnNote],
      [
        outcome({ kpId: "kp_b", learn: true }),
        outcome({ kpId: "kp_b", messageId: "m2" }), // 没做题
        outcome({ kpId: "kp_a", learn: false, messageId: "m3" }), // 类型不符
      ],
      kinds
    );
    expect([checked.hits, checked.misses]).toEqual([1, 0]);
  });
});

describe("notesFor / trustedNotes", () => {
  it("hits ≥ 2 的有效笔记、而且这一轮的讲法符合条件，才进提示词", () => {
    const trusted = { ...note, hits: 2 };
    expect(trustedNotes([note, trusted])).toEqual([trusted]);
    const plan = {
      order: "definition_first" as const,
      representation: "formula" as const,
      target_kc: "kp_a",
    };
    expect(notesFor([note, trusted], plan, "concept")).toEqual([trusted]);
    expect(
      notesFor([trusted], { ...plan, order: "example_first" }, "concept")
    ).toEqual([]);
  });
});

describe("mispredictions", () => {
  const attempt = (over: Partial<Attempt>): Attempt => ({
    at: "2026-10-23T11:05:00.000Z",
    correct: false,
    d: 0,
    hinted: false,
    id: "a1",
    prediction: {
      baseline: 0.8,
      expectLike: 0.6,
      learnRate: 0.15,
      M: 0.9,
      pCorrect: 0.8,
    },
    producedStep: false,
    provisional: false,
    quote: "不太清楚",
    sessionId: "c2",
    source: "fast",
    turnId: "u1",
    type: "check_wrong",
    ...over,
  });

  it("猜会答对却答错、猜会舒服却难受，都算猜错；要过提示的不算", () => {
    const misses = mispredictions(
      [
        { attempt: attempt({}), kpId: "kp_a" },
        { attempt: attempt({ correct: true, id: "a2" }), kpId: "kp_a" },
        { attempt: attempt({ hinted: true, id: "a3" }), kpId: "kp_a" },
      ],
      [
        outcome({ expectLike: 0.6, feel: false }),
        outcome({ expectLike: 0.6, feel: true, messageId: "m2" }),
        outcome({ messageId: "m3" }), // 旧记录没有预计喜欢
      ]
    );
    expect(misses).toEqual([
      {
        arm: "code:definition_first", // 答题之前最近一次讲解用的讲法
        attemptId: "a1",
        correct: false,
        kind: "learn",
        kpId: "kp_a",
        predicted: 0.8,
        quote: "不太清楚",
        sessionId: "c2",
      },
      {
        arm: "code:definition_first",
        feel: false,
        kind: "feel",
        kpId: "kp_a",
        messageId: "m1",
        predicted: 0.6,
        sessionId: "c2",
      },
    ]);
  });

  it("同一种讲法下攒够 2 次、这次又猜错了才写；笔记用过的证据不再算", () => {
    const miss = (id: string, sessionId: string, arm: string | null) => ({
      arm,
      feel: false,
      kind: "feel" as const,
      kpId: "kp_a",
      messageId: id,
      predicted: 0.6,
      sessionId,
    });
    // 只有一次：先攒着
    expect(
      readyMisses([miss("m1", "c2", "code:example_first")], [], "c2")
    ).toEqual([]);
    // demo 门槛 1：一次就写
    expect(
      readyMisses([miss("m1", "c2", "code:example_first")], [], "c2", 1)
    ).toHaveLength(1);
    // 上次攒了一次、这次又一次：两次一起交给 Claude；别的讲法的一次不带
    const pile = [
      miss("m0", "c1", "code:example_first"),
      miss("m1", "c2", "code:example_first"),
      miss("m9", "c2", "formula:example_first"),
    ];
    expect(readyMisses(pile, [], "c2").map((m) => m.sessionId)).toEqual([
      "c1",
      "c2",
    ]);
    // 这次没猜错：不写
    expect(readyMisses(pile.slice(0, 2), [], "c3")).toEqual([]);
    // 已经被笔记引用过的不再算
    expect(readyMisses(pile, [{ ...note, evidence: ["m0"] }], "c2")).toEqual(
      []
    );
  });
});

describe("applyNoteOps", () => {
  const now = "2026-10-23T12:00:00.000Z";
  let n = 0;
  const newId = () => {
    n += 1;
    return `new${n}`;
  };
  const op = (over: Partial<NoteOp>): NoteOp => ({
    evidence: ["m1"],
    expect: "feel_bad",
    id: "",
    op: "add",
    text: "他不喜欢公式",
    when: { representation: "formula" },
    ...over,
  });

  it("没引用给过的证据就不采纳", () => {
    expect(
      applyNoteOps(
        [note],
        [op({ evidence: ["瞎编"] })],
        new Set(["m1"]),
        now,
        newId
      )
    ).toEqual([note]);
  });

  it("增、改、删", () => {
    const out = applyNoteOps(
      [note],
      [op({}), op({ id: "n1", op: "edit", text: "他要先看例子" })],
      new Set(["m1"]),
      now,
      newId
    );
    const active = out.filter((x) => x.status === "active");
    expect(active.map((x) => x.text)).toEqual(["他不喜欢公式", "他要先看例子"]);
    // 改写的继承旧证据、从零检验；旧的一条标成已删
    expect(active[1]).toMatchObject({ evidence: ["m0", "m1"], hits: 0 });
    expect(out.find((x) => x.id === "n1")?.status).toBe("deleted");

    const removed = applyNoteOps(
      out,
      [op({ id: active[0].id, op: "delete" })],
      new Set(["m1"]),
      now,
      newId
    );
    expect(removed.filter((x) => x.status === "active")).toHaveLength(1);
  });

  it(`有效笔记最多 ${MAX_NOTES} 条`, () => {
    const out = applyNoteOps(
      [],
      Array.from({ length: MAX_NOTES + 3 }, (_, i) => op({ text: `规律${i}` })),
      new Set(["m1"]),
      now,
      newId
    );
    expect(out).toHaveLength(MAX_NOTES);
  });
});
