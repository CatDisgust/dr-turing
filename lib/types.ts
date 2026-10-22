import type { UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { Suggestion } from "./db/schema";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
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
};

export type NodeMisconception = {
  id: string;
  status: "suspected" | "confirmed" | "repaired";
  seen: number; // ≥ 2 → confirmed
  lastQuote: string;
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
  review: {
    stability: number;
    difficulty: number;
    lapses: number;
    lastAt?: string;
    dueAt?: string;
  };
  touchedInSession?: string;
  transferPassed: boolean; // 变式 / 迁移题过没过
  lastIndependentAt?: string;
  checkFlag?: "prereq_suspect"; // 保守传播：只标记待检查，不扣分
};

export type PendingQuestion = {
  kpId: string;
  questionId: string;
  askedTurnId: string;
  askedAt: string;
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
};
