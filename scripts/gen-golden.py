"""生成状态引擎的金标准用例：调 DeepTutor 的原函数，把输入和输出写成 JSON，
vitest 拿同样的输入跑 lib/learner 的翻译版，要求同输出（浮点差 < 1e-6）。

DeepTutor 源码不进本仓库（Apache-2.0，只翻译了几个纯函数），用的时候另外拉：

    git clone https://github.com/HKUDS/DeepTutor.git /tmp/DeepTutor
    python -m venv /tmp/dtenv && /tmp/dtenv/bin/pip install pydantic
    /tmp/dtenv/bin/python scripts/gen-golden.py /tmp/DeepTutor

BKT 那一组 DeepTutor 没有，用本文件里照公式写的 Python 参考实现生成，
另外把实现规划里那张 6 轮例子表的数字也放进去。
跑之前确认环境变量 LEARNING_DEBUG 没设（设了 DeepTutor 会把天换成秒）。
"""

from __future__ import annotations

import json
import random
import subprocess
import sys
from pathlib import Path

DT_ROOT = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(DT_ROOT))

from deeptutor.learning import mastery as dt_mastery  # noqa: E402
from deeptutor.learning import policy as dt_policy  # noqa: E402
from deeptutor.learning.scheduler import SpacedRepetitionScheduler  # noqa: E402
from deeptutor.learning.models import (  # noqa: E402
    DeferredObjective,
    ErrorRecord,
    ErrorType,
    KnowledgePoint,
    KnowledgeType,
    LearnerProfile,
    LearningEvidence,
    LearningModule,
    LearningProgress,
    PendingQuestion,
    QuizAttempt,
    RepetitionState,
    ReviewTask,
)

OUT = Path(__file__).resolve().parent.parent / "lib/learner/__tests__/golden.json"
rng = random.Random(5348)
KINDS = ["memory", "procedure", "concept", "design"]
NOW = 1_800_000_000.0


def compute_mastery_cases(n: int) -> list[dict]:
    cases = []
    for _ in range(n):
        seq: list[bool | float] = []
        for _ in range(rng.randint(0, 8)):
            seq.append(rng.random() < 0.6 if rng.random() < 0.7 else round(rng.random(), 2))
        cases.append({"input": seq, "output": dt_mastery.compute_mastery(seq)})
    return cases


STAGE_NAMES = {
    "independently_demonstrated": "independent",
    "practiced_with_help": "correct_with_help",
    "practiced_not_demonstrated": "practiced_unproven",
    "partially_explained": "explained",
    "teaching_record_unverified": "explained",
    "not_yet_covered": "not_covered",
}

ATTEMPT_TYPES = {
    "check_correct": True,
    "check_wrong": False,
    "review_correct": True,
    "transfer_correct": True,
    "self_explained": None,  # 对错随机
    "said_understood": "ungraded",
    "asked_help": "ungraded",
}


def learning_stage_cases(n: int) -> list[dict]:
    cases = []
    for _ in range(n):
        attempts = []
        quizzes: list[QuizAttempt] = []
        evidence: list[LearningEvidence] = []
        for i in range(rng.randint(0, 4)):
            kind = rng.choice(list(ATTEMPT_TYPES))
            hinted = rng.random() < 0.4
            graded = ATTEMPT_TYPES[kind]
            attempt = {"type": kind, "hinted": hinted}
            if graded == "ungraded":
                attempts.append(attempt)
                continue
            correct = rng.random() < 0.5 if graded is None else graded
            attempt["correct"] = correct
            attempts.append(attempt)
            if kind == "self_explained":
                evidence.append(
                    LearningEvidence(
                        knowledge_point_id="kp",
                        assessment_type="qualitative",
                        result="correct" if correct else "incorrect",
                        hints_used=1 if hinted else 0,
                    )
                )
            else:
                quizzes.append(
                    QuizAttempt(
                        question_id=f"q{i}",
                        knowledge_point_id="kp",
                        is_correct=correct,
                        independent=not hinted,
                    )
                )
        explained = rng.random() < 0.5
        progress = LearningProgress(
            book_id="b",
            quiz_attempts=quizzes,
            learning_evidence=evidence,
            explained_objectives={"kp": {"summary": "讲过"}} if explained else {},
        )
        stage = dt_policy.learning_stage(progress, "kp")
        cases.append(
            {
                "input": {"attempts": attempts, "explained": explained},
                "dt": stage,
                "output": STAGE_NAMES[stage],
            }
        )
    return cases


def next_objective_cases(n: int) -> list[dict]:
    cases = []
    for _ in range(n):
        modules = []
        kinds: dict[str, str] = {}
        mastered: list[str] = []
        seen: list[str] = []
        attempts: list[QuizAttempt] = []
        levels: dict[str, float] = {}
        qualitative: dict[str, bool] = {}
        lessons = []
        orders = rng.sample(range(1, 10), rng.randint(1, 3))
        for li, order in enumerate(orders):
            ids = [f"kp_l{li}_{k}" for k in range(rng.randint(1, 4))]
            kps = []
            for kp_id in ids:
                kind = rng.choice(KINDS)
                kinds[kp_id] = kind
                kps.append(KnowledgePoint(id=kp_id, name=kp_id, type=KnowledgeType(kind), module_id=f"m{li}"))
                state = rng.choice(["new", "seen", "mastered"])
                if state != "new":
                    seen.append(kp_id)
                    attempts.append(
                        QuizAttempt(question_id=f"q_{kp_id}", knowledge_point_id=kp_id, is_correct=True)
                    )
                if state == "mastered":
                    mastered.append(kp_id)
                    if kind in ("concept", "design"):
                        qualitative[kp_id] = True
                    else:
                        levels[kp_id] = 0.95
                elif state == "seen":
                    levels[kp_id] = 0.5
            modules.append(LearningModule(id=f"m{li}", name=f"m{li}", order=order, knowledge_points=kps))
            lessons.append({"id": f"m{li}", "order": order, "pointIds": ids})

        all_ids = list(kinds)
        pending = rng.choice(all_ids) if rng.random() < 0.15 else None
        reviews = []
        tasks = []
        for t in range(rng.choice([0, 0, 0, 1, 2, 3])):
            kp_id = rng.choice(all_ids) if rng.random() < 0.9 else "kp_missing"
            due = NOW + rng.choice([-86400 * 3, -3600, -60, 0, 60, 86400])
            risk = rng.choice([0.2, 0.5, 0.5, 0.8])
            priority = rng.randint(1, 3)
            reviews.append({"kpId": kp_id, "dueAt": due, "forgettingRisk": risk, "priority": priority})
            tasks.append(
                ReviewTask(
                    id=f"r{t}",
                    knowledge_point_id=kp_id,
                    knowledge_type=KnowledgeType(kinds.get(kp_id, "memory")),
                    due_at=due,
                    priority=priority,
                    state=RepetitionState(next_review_at=due),
                    forgetting_risk=risk,
                )
            )
        deferred = [kp for kp in all_ids if rng.random() < 0.15]
        teach_first = rng.random() < 0.5

        progress = LearningProgress(
            book_id="b",
            modules=modules,
            quiz_attempts=attempts,
            mastery_levels=levels,
            qualitative_mastery=qualitative,
            review_queue=tasks,
            deferred_objectives={kp: DeferredObjective(knowledge_point_id=kp) for kp in deferred},
            learner_profile=LearnerProfile(teaching_strategy="teach_first") if teach_first else None,
            pending_question=(
                PendingQuestion(question_id="pq", knowledge_point_id=pending, prompt="?")
                if pending
                else None
            ),
        )
        # 用 DeepTutor 自己的门槛核对一遍“已掌握”集合，保证两边输入一致
        dt_mastered = [kp.id for m in modules for kp in m.knowledge_points if dt_policy.is_mastered(progress, kp)]
        assert sorted(dt_mastered) == sorted(mastered), (dt_mastered, mastered)

        step = dt_policy.next_objective(progress, now=NOW)
        cases.append(
            {
                "input": {
                    "lessons": lessons,
                    "kinds": kinds,
                    "mastered": mastered,
                    "seen": seen,
                    "pendingKpId": pending,
                    "reviews": reviews,
                    "deferred": deferred,
                    "teachFirst": teach_first,
                    "now": NOW,
                },
                "output": {"action": step.action, "kpId": step.knowledge_point_id or None},
            }
        )
    return cases


# ---- BKT 参考实现（不是 DeepTutor 的），按主文档的更新表 ----
G, S, L, PRIOR = 0.2, 0.1, 0.15, 0.3
REVEALED_LEARN_FACTOR, REVIEW_PULL = 0.5, 0.5


def bkt(m: float, correct: bool, learn: float = L) -> float:
    post = m * (1 - S) / (m * (1 - S) + (1 - m) * G) if correct else m * S / (m * S + (1 - m) * (1 - G))
    return post + (1 - post) * learn


def replay(steps: list[dict]) -> list[dict]:
    m, o, out = PRIOR, 0.0, []
    for step in steps:
        if "correct" in step:
            correct, d = step["correct"], step["d"]
            # 答案被揭示后照着做对：学习率减半
            nm = bkt(m, correct, L * REVEALED_LEARN_FACTOR if correct and d == 0 else L)
            no = min(nm, o + d * max(nm - m, 0.0))
            # 隔天复习独立做对：O 向 M 靠拢
            if step.get("review") and correct and d == 1:
                no = min(nm, max(no, o + REVIEW_PULL * (nm - o)))
            m, o = nm, no
        out.append({"M": m, "O": o})
    return out


def bkt_cases(n: int) -> list[dict]:
    cases = []
    for _ in range(n):
        steps = []
        for _ in range(rng.randint(1, 10)):
            if rng.random() < 0.15:
                steps.append({})  # 没批改的证据，不动 M、O
            else:
                step = {"correct": rng.random() < 0.65, "d": rng.choice([1, 0.5, 0])}
                if rng.random() < 0.2:
                    step["review"] = True
                steps.append(step)
        cases.append({"input": steps, "output": replay(steps)})
    return cases


def state_dict(st: RepetitionState) -> dict:
    return {
        "intervalIndex": st.interval_index,
        "consecutiveCorrect": st.consecutive_correct,
        "consecutiveWrong": st.consecutive_wrong,
        "nextReviewAt": st.next_review_at,
        "difficulty": st.difficulty,
        "stability": st.stability,
        "retrievability": st.retrievability,
        "desiredRetention": st.desired_retention,
        "reviewCount": st.review_count,
        "lapseCount": st.lapse_count,
        "lastReviewAt": st.last_review_at,
        "lastScheduledAt": st.last_scheduled_at,
        "scheduledAfterFailure": st.scheduled_after_failure,
    }


def scheduler_cases(n: int) -> list[dict]:
    sched = SpacedRepetitionScheduler()
    assert not sched.DEBUG_MODE
    cases = []
    gaps = [0, 60, 3600, 6 * 3600, 86400, 3 * 86400, 7 * 86400, 20 * 86400]
    for _ in range(n):
        kind = rng.choice(KINDS)
        t = NOW
        events = []
        for _ in range(rng.randint(1, 8)):
            t += rng.choice(gaps)
            result = rng.choice(["correct", "correct", "incorrect", "partial"])
            ev = {
                "timestamp": t,
                "result": result,
                "quality": round(rng.random(), 2) if rng.random() < 0.2 else None,
                "hintsUsed": rng.choice([0, 0, 1, 3]),
                "attemptCount": rng.choice([1, 1, 2, 4]),
                "assessmentType": rng.choice(["quiz", "qualitative", "review"]),
            }
            events.append(ev)
        dt_events = [
            LearningEvidence(
                knowledge_point_id="kp",
                timestamp=e["timestamp"],
                result=e["result"],
                quality=e["quality"],
                hints_used=e["hintsUsed"],
                attempt_count=e["attemptCount"],
                assessment_type=e["assessmentType"],
            )
            for e in events
        ]
        states = []
        state = sched.get_initial_state(KnowledgeType(kind), now=events[0]["timestamp"])
        for ev in dt_events:
            sched.schedule_review(state, KnowledgeType(kind), ev, now=ev.timestamp)
            states.append(state_dict(state))
        later = t + rng.choice(gaps)
        has_error = rng.random() < 0.3
        progress = LearningProgress(
            book_id="b",
            error_records=(
                [ErrorRecord(id="e", question_id="q", knowledge_point_id="kp", module_id="m", error_type=ErrorType.APPLICATION_ERROR)]
                if has_error
                else []
            ),
        )
        cases.append(
            {
                "kind": kind,
                "events": events,
                "states": states,
                "later": later,
                "hasActiveError": has_error,
                "retrievability": sched.retrievability(state, now=later),
                "forgettingRisk": sched.forgetting_risk(state, progress, "kp", now=later),
            }
        )
    return cases


# 实现规划“会话内的导师逻辑”那张 6 轮表：竞争条件，从 M = 0.3、O = 0 开始
PLAN_TABLE = {
    "steps": [
        {},
        {"correct": True, "d": 1},
        {},
        {"correct": True, "d": 0.5},
        {"correct": False, "d": 0},
        {"correct": True, "d": 1},
    ],
    # 表里写的两位小数
    "expected": [
        {"M": 0.3, "O": 0},
        {"M": 0.71, "O": 0.41},
        {"M": 0.71, "O": 0.41},
        {"M": 0.93, "O": 0.52},
        {"M": 0.68, "O": 0.52},
        {"M": 0.92, "O": 0.76},
    ],
}


def main() -> None:
    commit = subprocess.run(
        ["git", "-C", str(DT_ROOT), "rev-parse", "HEAD"], capture_output=True, text=True
    ).stdout.strip()
    golden = {
        "deeptutorCommit": commit,
        "computeMastery": compute_mastery_cases(200),
        "gate": [
            {
                "kind": k,
                "threshold": dt_policy.gate_threshold(KnowledgeType(k)),
                "gateKind": dt_policy.gate_kind(
                    KnowledgePoint(id="kp", name="kp", type=KnowledgeType(k), module_id="m")
                ),
            }
            for k in KINDS
        ],
        "learningStage": learning_stage_cases(300),
        "nextObjective": next_objective_cases(300),
        "bkt": bkt_cases(200),
        "scheduler": scheduler_cases(300),
        "planTable": {**PLAN_TABLE, "replay": replay(PLAN_TABLE["steps"])},
    }
    OUT.write_text(json.dumps(golden, ensure_ascii=False) + "\n")
    print(f"wrote {OUT} (DeepTutor {commit[:7]})")


if __name__ == "__main__":
    main()
