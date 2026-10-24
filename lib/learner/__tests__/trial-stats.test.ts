import { describe, expect, it } from "vitest";
import type { Attempt } from "@/lib/types";
import { learnStats } from "../trial-stats";
import { emptyLearnerState, emptyNode } from "../update";

const attempt = (
  type: Attempt["type"],
  correct?: boolean,
  over: Partial<Attempt> = {}
): Attempt => ({
  at: "2026-10-20T00:00:00Z",
  correct,
  d: 1,
  hinted: false,
  id: type,
  producedStep: false,
  provisional: false,
  quote: "",
  sessionId: "s",
  source: "fast",
  turnId: "t",
  type,
  ...over,
});

describe("learnStats", () => {
  it("数答题、点亮和该复习的点，跨几门课加起来", () => {
    const a = emptyLearnerState("u", "c1");
    a.nodes.k1 = {
      ...emptyNode(),
      attempts: [
        attempt("check_correct", true),
        attempt("check_wrong", false),
        attempt("review_correct", true, { questionKind: "review" }),
        attempt("check_correct", true, {
          hinted: true,
          questionKind: "review",
        }),
        attempt("said_understood"),
      ],
      M: 0.9,
      O: 0.8,
    };
    a.nodes.k2 = {
      ...emptyNode(),
      attempts: [attempt("check_correct", true)],
      lastIndependentAt: "2026-10-20T00:00:00Z",
      M: 0.7,
      O: 0.4,
    };
    const b = emptyLearnerState("u", "c2");
    b.nodes.k3 = { ...emptyNode(), M: 0.1, O: 0 };
    expect(learnStats([a, b], "2026-10-24T00:00:00Z")).toEqual({
      answered: 5,
      correct: 4,
      due: 1,
      full: 1,
      half: 1,
      reviewed: 2,
      reviewPassed: 1,
    });
  });

  it("没学过就全是 0", () => {
    expect(learnStats([], "2026-10-24T00:00:00Z").answered).toBe(0);
  });
});
