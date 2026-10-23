import type { LearnerState, StudentEventType } from "@/lib/types";

// 学生的反应事件（学生建模方案 A）。Event 表只追加，是原始记录；
// LearnerState.engagement 里只留最近还有分量的几条，方便每轮现算 W、B

export const EVENT_TYPES = [
  "give_up",
  "just_tell_me",
  "skip",
  "still_lost",
  "too_abstract",
  "thumbs_up",
  "thumbs_down",
  "asked_followup",
  "review_retract",
  "review_flip",
] as const satisfies readonly StudentEventType[];

export type EventType = StudentEventType;

// 投入度 W：不想学了的信号；负担 B：听不懂、太抽象
const W_TYPES: readonly EventType[] = [
  "give_up",
  "just_tell_me",
  "skip",
  "thumbs_down",
];
const B_TYPES: readonly EventType[] = ["still_lost", "too_abstract"];

// 半衰期 4 轮：4 轮前的一次放弃只剩一半分量（学生建模方案 A）
export const HALF_LIFE_TURNS = 4;
// W 到这个数算偏低，规划先安抚（学生建模方案 A）
export const W_LOW = 2;
// B 到这个数，导师讲得更具体、步子更小：大约是 4 轮内说过一次（假设）
export const B_HIGH = 0.5;
// 分量低于这个就从状态里丢掉（Event 表里还在）
const NEGLIGIBLE = 0.01;

export type RecentEvent = { type: EventType; turn: number };

export function emptyEngagement(): LearnerState["engagement"] {
  return { recent: [], turn: 0 };
}

// 旧数据里 engagement 还是累计次数，没有轮次：当作从零开始
export function engagementOf(
  state: Pick<LearnerState, "engagement">
): LearnerState["engagement"] {
  const e = state.engagement as Partial<LearnerState["engagement"]> | undefined;
  return Array.isArray(e?.recent) && typeof e?.turn === "number"
    ? (e as LearnerState["engagement"])
    : emptyEngagement();
}

function decayed(
  recent: readonly RecentEvent[],
  turn: number,
  types: readonly EventType[]
): number {
  return recent
    .filter((e) => types.includes(e.type))
    .reduce(
      (sum, e) => sum + 0.5 ** (Math.max(turn - e.turn, 0) / HALF_LIFE_TURNS),
      0
    );
}

// W = Σ 0.5^(Δ轮/4)，只算负面事件；B 同理
export function signals(engagement: LearnerState["engagement"]): {
  W: number;
  B: number;
} {
  return {
    B: decayed(engagement.recent, engagement.turn, B_TYPES),
    W: decayed(engagement.recent, engagement.turn, W_TYPES),
  };
}

export function engagementLow(engagement: LearnerState["engagement"]): boolean {
  return signals(engagement).W >= W_LOW;
}

// 学生每发一条消息算一轮
export function nextTurn(state: LearnerState): LearnerState {
  const engagement = engagementOf(state);
  return { ...state, engagement: { ...engagement, turn: engagement.turn + 1 } };
}

// 只留还有分量的事件
function keep(recent: readonly RecentEvent[], turn: number) {
  return {
    recent: recent.filter(
      (e) => 0.5 ** ((turn - e.turn) / HALF_LIFE_TURNS) >= NEGLIGIBLE
    ),
    turn,
  };
}

// 记一条事件进状态
export function recordEvent(
  state: LearnerState,
  type: EventType
): LearnerState {
  const { recent, turn } = engagementOf(state);
  return { ...state, engagement: keep([...recent, { turn, type }], turn) };
}

// 从 Event 表重算状态里的 engagement（学生建模方案 F：状态都能从原始记录推出来）
export function engagementFromEvents(
  events: readonly RecentEvent[],
  turn: number
): LearnerState["engagement"] {
  return keep(
    events.filter((e) => e.turn <= turn).toSorted((a, b) => a.turn - b.turn),
    turn
  );
}
