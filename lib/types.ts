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
