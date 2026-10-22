import type { UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { Suggestion } from "./db/schema";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
  plan: z.custom<TutorPlan>().optional(),
});

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
  };
};

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
  misconceptions: z.array(z.string()),
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
  misconceptionId?: string;
  source: "fast" | "slow" | "student_edit";
  provisional: boolean; // 快路径写入时为 true，复核后转正或撤销
  // 答的是哪种题；“保持”这项能力只看隔天复习题。D9 之前的证据没有这个字段
  questionKind?: PendingQuestion["kind"];
};

export type NodeMisconception = {
  id: string;
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
  verdict: "confirm" | "retract";
  reason: string;
};

// 会话报告：这次是教会了，还是替他做完了（LearnTrace readouts）
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
};

export type LearnerState = {
  studentId: string;
  courseId: string;
  profile: {
    background: string[];
    statedPreferences: { text: string; quote: string }[];
  };
  burden: { tooAbstract: number; lost: number; lastAt?: string };
  // 投入度 W：偏低时规划先修复情绪
  engagement: {
    giveUps: number;
    justTellMe: number;
    skippedQuestions: number;
    lastAt?: string;
  };
  nodes: Record<string, NodeState>;
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
  // 每次复核的新增 / 更新 / 作废，带原话，只追加
  log: {
    at: string;
    sessionId: string;
    op: "add" | "update" | "invalidate";
    conceptId: string;
    quote: string;
  }[];
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
