import type { UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { Suggestion } from "./db/schema";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
  plan: z.custom<TutorPlan>().optional(),
  timing: z.custom<TurnTiming>().optional(),
});

// 一轮各段用了多少毫秒（D12 验收：划词到讲解首字 ≤ 3 秒）。只在当场显示，不存库
export type TurnTiming = {
  // 读状态 + 批改或归类
  engineMs: number;
  // 规则定动作 + Claude 填规划
  planMs: number;
  // 从收到请求到讲解第一个字
  firstTokenMs: number;
  fastModel: string;
};

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

// D1 不给模型任何工具；以后的检查题、诊断等动作再在这里加
export type ChatTools = Record<string, never>;

export type WaitingStatusData = {
  phase: "waiting" | "still-waiting" | "health" | "thinking";
  message: string;
  modelId: string;
  modelName: string;
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  "chat-title": string;
  "waiting-status": WaitingStatusData;
  "node-touched": { kpId: string; name: string };
  graded: {
    kpId: string;
    name: string;
    correct: boolean;
    misconception?: string;
    // 学生交卷前说的把握，没选就没有
    confidence?: Confidence;
  };
  // 检查题卡片：题面由代码写，界面画成卡片（交互方案 D）
  check: CheckCard;
  // 回答里嵌的小模拟（交互方案 C），现在只有死锁一种
  sim: { kind: "deadlock"; kpId: string };
};

export type CheckCard = {
  kpId: string;
  name: string;
  question: string;
  // 诊断题不走 PendingQuestion，卡片上只留“先不做题”
  kind: "check" | "variant" | "review" | "diagnosis";
  // 答错、要了提示或答案之后同一道题再出一次
  retry: boolean;
};

// 交卷前学生自己说有多确定：猜的、有点把握、很确定（交互方案 D，先只记不算分）
export type Confidence = "guess" | "somewhat" | "sure";

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};

// ---- 课程图谱（M1）----
// 课程 → 课 → 知识点；字段按实现规划，前后端和 zod 共用

export const knowledgeKindSchema = z.enum([
  "memory",
  "procedure",
  "concept",
  "design",
]);

// 出处：知识点在哪一课、哪个文件、第几页，原文摘一句
export const sourceSchema = z.object({
  fileId: z.string(),
  lessonId: z.string(),
  page: z.number().int().min(1),
  quote: z.string().min(1),
});

export const knowledgePointSchema = z.object({
  aliases: z.array(z.string()),
  checkQuestions: z.array(z.string()),
  definition: z.string(),
  id: z.string().startsWith("kp_"),
  kind: knowledgeKindSchema,
  lessonId: z.string(),
  name: z.string().min(1),
  sources: z.array(sourceSchema).min(1),
  status: z.enum(["auto", "reviewed"]),
});

export const lessonSchema = z.object({
  fileIds: z.array(z.string()),
  id: z.string(),
  index: z.number().int().min(1),
  title: z.string(),
});

export const edgeSchema = z.object({
  from: z.string(),
  status: z.enum(["tentative", "confirmed"]),
  to: z.string(),
  type: z.enum(["part_of", "prereq", "confusable"]),
});

export const courseGraphSchema = z.object({
  builtAt: z.string(),
  courseId: z.string(),
  edges: z.array(edgeSchema),
  lessons: z.array(lessonSchema),
  name: z.string(),
  points: z.array(knowledgePointSchema),
});

export type KnowledgeKind = z.infer<typeof knowledgeKindSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type KnowledgePoint = z.infer<typeof knowledgePointSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type Edge = z.infer<typeof edgeSchema>;
export type CourseGraph = z.infer<typeof courseGraphSchema>;

// ---- 学生状态（M2）----
// 一个学生 × 一门课一份；字段按实现规划，名字尽量和 DeepTutor / LearnTrace 对齐

// DeepTutor policy.learning_stage 的五档，按独立程度从低到高
export type LearningStage =
  | "not_covered"
  | "explained"
  | "practiced_unproven"
  | "correct_with_help"
  | "independent";

// 一条证据。掌握度只从这里算
export type Attempt = {
  id: string;
  sessionId: string;
  turnId: string;
  at: string;
  type:
    | "self_explained"
    | "check_correct"
    | "check_wrong"
    | "review_correct"
    | "transfer_correct"
    | "said_understood"
    | "asked_help";
  // 构建深度：独立做对 1，小提示后做对 0.5，导师揭示后照做 0
  d: 1 | 0.5 | 0;
  correct?: boolean; // 只有批改过的题才有
  hinted: boolean; // 答之前要过提示或答案
  producedStep: boolean;
  quote: string; // 学生原话
  // 答错时从学生这句话里提出的错误想法，一句话；看不出具体想法就没有。
  // 只记在这个学生身上，不进课程图谱（用户 2026-10-22）
  misconception?: string;
  source: "fast" | "slow" | "student_edit";
  provisional: boolean; // 快路径写入时为 true，复核后转正或撤销
  // 答的是哪种题；“保持”这项能力只看隔天复习题。D9 之前的证据没有这个字段
  questionKind?: PendingQuestion["kind"];
  // 出题时的预测，批改时从 PendingQuestion 抄过来，Transaction 里预测和结果放在一起
  prediction?: Prediction;
  // 交卷前学生说的把握（交互方案 D）。先只记下来，不进掌握度
  confidence?: Confidence;
};

// 学生自己的错误模式：从他的错答里提出来的，同一个想法按原文归到一起
export type NodeMisconception = {
  id: string;
  text: string;
  status: "suspected" | "confirmed" | "repaired";
  seen: number; // ≥ 2 → confirmed
  lastQuote: string;
};

// 复习调度状态：DeepTutor RepetitionState，字段一一对应，时间用秒
export type RepetitionState = {
  intervalIndex: number;
  consecutiveCorrect: number;
  consecutiveWrong: number;
  nextReviewAt: number;
  difficulty: number;
  stability: number;
  retrievability: number;
  desiredRetention: number;
  reviewCount: number;
  lapseCount: number;
  lastReviewAt: number | null;
  lastScheduledAt: number | null;
  scheduledAfterFailure: boolean;
};

export type NodeState = {
  attempts: Attempt[];
  M: number; // 表面掌握 0–1，所有答对都算
  O: number; // 自主掌握 0–1，只算不靠提示的；始终 O ≤ M
  stage: LearningStage;
  explained: boolean; // 导师讲过这个点
  helpRequests: number;
  helpOpportunities: number;
  misconceptions: NodeMisconception[];
  stuckSessions: string[];
  review: RepetitionState | null; // 第一次批改后才开始排复习
  touchedInSession?: string;
  transferPassed: boolean; // 变式 / 迁移题过没过
  lastIndependentAt?: string;
  checkFlag?: "prereq_suspect"; // 保守传播：只标记待检查，不扣分
  // 会后复核撤掉的证据，连同原因留在证据栏里
  retracted?: RetractedAttempt[];
};

export type RetractedAttempt = {
  attempt: Attempt;
  reason: string;
  at: string;
};

// 只追加的作答记录（LearnTrace 的 transaction）：每次批改一行，掌握度和底层能力都能从它重算
export type Transaction = {
  studentId: string;
  courseId: string;
  sessionId: string;
  kpId: string;
  messageId: string;
  attempt: Attempt;
};

// 会后复核对一条暂定证据的结论
export type ReviewVerdict = {
  attemptId: string;
  // flip：作答有效但对错判反了，改判（建模审查第 2 条）
  verdict: "confirm" | "retract" | "flip";
  reason: string;
};

// 会话报告：这次是教会了，还是替他做完了（LearnTrace readouts）
// 学生模型（学生建模方案 F），跨课程每个学生一份。learnRate、arms、calibration、style 由后面几步填，
// 这一步先建表、先能从原始记录重算；notes 是 Claude 写的文字，不重算
// 预测和结果的核对（学生建模方案 D）。只算出题后没要提示、没看答案就作答的题。
// logLoss、brier 越小越准；baseline 是所有人共用一套参数（ℓ = 0.15）时的同样两个数
export type Calibration = {
  n: number;
  hits: number; // 猜的方向对了几题（p ≥ 0.5 猜对、p < 0.5 猜错）
  logLoss: number;
  brier: number;
  baseline: { logLoss: number; brier: number };
};

// 一种讲法的原始计数（方案 C）：学得好 = 讲完后同一点下一道批改题独立答对；
// 感受好 = 之后 2 轮内没有负面反应
export type ArmCounts = {
  learn: { n: number; k: number };
  feel: { n: number; k: number };
};

// 教学笔记（方案 E）：Claude 写的一句话规律，附证据；数字由代码检验。
// when 里没写的项不限；expect 是这种讲法下预计的结果
export type TeachingNote = {
  id: string;
  text: string;
  when: {
    representation?: TutorPlan["representation"];
    order?: TutorPlan["order"];
    kind?: KnowledgePoint["kind"];
  };
  expect: "learn_good" | "learn_bad" | "feel_good" | "feel_bad";
  evidence: string[]; // 证据 id：作答 id 或导师消息 id
  createdAt: string;
  // 检验：写下之后每遇到一轮符合 when 的讲解，结果对上 expect 记 hits，对不上记 misses
  hits: number;
  misses: number;
  // dropped：misses 比 hits 多 2 次，代码自动删；deleted：Claude 复核时删
  status: "active" | "dropped" | "deleted";
};

export type StudentModelData = {
  // 个人化 BKT 的学习率（方案 B）；还没拟合时用全局值
  learnRate: number;
  // 每种讲法用了几次、效果如何（方案 C），键是 "representation:order"
  arms: Record<string, ArmCounts>;
  // 预测准不准（方案 D）：没有可核对的题时为 null
  calibration: Calibration | null;
  style: null;
  notes: TeachingNote[];
  // 下面两项是这一步就能算的：各种反应各出现几次、答了多少题
  reactions: Partial<Record<StudentEventType, number>>;
  answers: { total: number; independentCorrect: number };
  rebuiltFrom: { transactions: number; events: number };
};

export type SessionReport = {
  sessionId: string;
  reviewedAt: string;
  steps: number; // 这次批改过的作答
  ownSteps: number; // 其中没要提示、自己答对的
  revealRate: number | null; // 看了答案才作答的比例
  selfProducedRate: number | null; // 学生自己做出步骤的比例
  leaks: number; // 导师没被要求就把答案说出来的轮数（复核判断）
  oGain: { kpId: string; name: string; before: number; after: number }[];
  confirmed: number;
  retracted: { kpId: string; name: string; quote: string; reason: string }[];
  // 改判的证据：correct 是改判后的结论
  revised?: {
    kpId: string;
    name: string;
    quote: string;
    reason: string;
    correct: boolean;
  }[];
  // 这次复核对个人图谱课外概念的改动
  concepts?: { op: "add" | "update" | "invalidate"; name: string }[];
};

// 导师留给学生的一道题。题和批改依据都在服务端，学生看到的只有题面
export type PendingQuestion = {
  kpId: string;
  questionId: string;
  askedTurnId: string;
  askedAt: string;
  sessionId: string;
  question: string;
  // 检查题、变式题，或者隔天的复习题
  kind: "check" | "variant" | "review";
  // 答之前要过什么：没要、要了提示、要了答案
  help: "none" | "hint" | "revealed";
  // 出题时模型先猜他能不能独立答对（学生建模方案 D）。D 之前出的题没有
  prediction?: Prediction;
};

// 模型出题前的预测：pCorrect = M(1−s) + (1−M)g，用当时的 M 和学习率 ℓ。
// baseline 是同样的证据、所有人共用 ℓ = 0.15 时的 pCorrect，做对照。
// expectLike 是所选讲法“预计喜欢”的得分，挑讲法（方案 C）做好之前为 null
export type Prediction = {
  pCorrect: number;
  baseline: number;
  M: number;
  learnRate: number;
  expectLike: number | null;
};

export type StudentEventType =
  | "give_up"
  | "just_tell_me"
  | "skip"
  | "still_lost"
  | "too_abstract"
  | "thumbs_up"
  | "thumbs_down"
  | "asked_followup"
  // 会后复核撤销、改判了一条证据（payload.attemptId），重算时用
  | "review_retract"
  | "review_flip";

export type LearnerState = {
  studentId: string;
  courseId: string;
  profile: {
    background: string[];
    statedPreferences: { text: string; quote: string }[];
  };
  // 投入度 W、负担 B 的原料：最近还有分量的反应事件，按轮次衰减（学生建模方案 A，lib/learner/events.ts）。
  // turn 是这门课里学生发了多少条消息。完整记录在 Event 表
  engagement: {
    turn: number;
    recent: { type: StudentEventType; turn: number }[];
  };
  nodes: Record<string, NodeState>;
  // 这个学生的学习率 ℓ（学生建模方案 B），每次结束学习时从全部作答拟合；没有就用全局 0.15
  learnRate?: number;
  // 讲法的得分（方案 C），结束学习时从 StudentModel 带过来：own 是他自己的计数，
  // prior 是全体学生每种讲法的平均效果（经验贝叶斯先验）
  arms?: {
    own: Record<string, ArmCounts>;
    prior: Record<string, { learn: number; feel: number }>;
  };
  // 检验过的教学笔记（hits ≥ 2），结束学习时从 StudentModel 带过来，放进导师提示词（方案 E）
  teachingNotes?: TeachingNote[];
  pendingQuestion?: PendingQuestion;
  // 诊断入口进行中：这一课、还没问的前置
  diagnosis?: {
    sessionId: string;
    lessonId: string;
    queue: string[];
    asked: string[];
  };
};

// ---- 规划器输出（M3）：LearnTrace 导师动作 + 主文档的“程度 / 方式”字段 ----
export type TutorPlan = {
  target_kc: string;
  next_action:
    | "diagnose_misconception"
    | "teach"
    | "hint"
    | "independent_check"
    | "variant"
    | "review";
  prompt: "aha" | "counterexample" | "min_hint" | "question" | "review";
  rule: number; // 命中七条规则里的第几条
  action_type: "explain" | "scaffold" | "hint" | "ask" | "worked_example";
  disclosure_level: "question" | "hint" | "partial" | "full";
  elicits_production: boolean;
  reveals_answer: boolean;
  start_from: string[]; // 跳过哪些已掌握的先修（kp id）
  representation: "analogy" | "code" | "formula" | "diagram";
  // 先例子还是先定义（方案 C）；和 representation 一起由代码按得分挑（Message_v2 里的旧记录没有）
  order: "example_first" | "definition_first";
  // 所选讲法“感受好”的后验均值，出题时写进预测的 expectLike（方案 D）
  expect_like?: number;
  check_misconception_first?: string; // 误解原文
  rationale: string;
  // 动作永远由规则定；其余字段正常由 Claude 填，调用失败时退回规则默认值
  filled_by?: "claude" | "rules" | "diagnosis";
};

// ---- 个人图谱（D9b，叠加模型）：课内知识点的状态就是 LearnerState；
// 这里只存对不上任何课程知识点的“课外概念”，一律标“未锚定”，学生可以删 ----
export type PersonalConcept = {
  id: string;
  name: string;
  // 学生和 Claude 用过的其他叫法：认人时一起比，认出来了就记进来
  aliases: string[];
  definition: string;
  // 未锚定；被复核作废的保留原因，不再显示
  status: "unanchored" | "invalidated";
  // 只到“接触过 / 自称会”两档：课外概念没有检查题，算不上“会”
  level: "touched" | "claimed";
  evidence: { sessionId: string; quote: string; at: string }[];
  note?: string;
  createdAt: string;
};

export type PersonalGraph = {
  studentId: string;
  concepts: PersonalConcept[];
  // 学生在对话里顺口提到的课程知识点：kp id → 出处（只记出处，不动掌握度）。旧数据没有
  courseMentions?: Record<
    string,
    { sessionId: string; quote: string; at: string }[]
  >;
  // 每次复核的新增 / 更新 / 作废，带原话，只追加
  log: {
    at: string;
    sessionId: string;
    op: "add" | "update" | "invalidate";
    conceptId: string;
    quote: string;
  }[];
};

// 个人知识库的原始记录（只追加，从不改、不删）：个人图谱整份从这里算（方案 ④ 证据日志）。
// conceptId 是课外概念的编号 pc_N，或课程知识点的 id（学生顺口提到课程里的点，只记出处，不动掌握度）
export type ConceptEventType =
  | "mention" // 某次对话里提到了它
  | "invalidate" // 记错了：复核或学生说的
  | "merge" // 两个其实是同一个：from 并进 conceptId
  | "split"; // 撤销一次合并
export type ConceptEventPayload = {
  name?: string;
  definition?: string;
  level?: PersonalConcept["level"];
  quote?: string;
  reason?: string;
  from?: string; // merge：被并掉的那个
  mergeId?: string; // split：撤销哪次合并
  by?: "review" | "student";
};
export type ConceptEvent = {
  id: string;
  studentId: string;
  conceptId: string;
  sessionId: string | null;
  type: ConceptEventType;
  payload: ConceptEventPayload;
  at: string;
};

// 复核给出的课外概念变更
export type ConceptChange = {
  op: "add" | "update" | "invalidate";
  // 已有课外概念或课程知识点的 id；新概念留空
  sameAs: string;
  name: string;
  definition: string;
  level: PersonalConcept["level"];
  quote: string;
  reason: string;
};

// 底层能力：代码从全部证据统计，贝叶斯比例估计（Beta-binomial）
export type Ability = {
  key: "self_explanation" | "independence" | "retention";
  label: string;
  value: number; // 后验均值 (k + α) / (n + α + β)
  low: number; // 95% 区间
  high: number;
  k: number;
  n: number;
  certain: boolean; // 证据够不够下结论
  evidence: { quote: string; at: string; success: boolean }[];
};
