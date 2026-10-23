import { z } from "zod";

const textPartSchema = z.object({
  text: z.string().min(1).max(2000),
  type: z.enum(["text"]),
});

const filePartSchema = z.object({
  mediaType: z.enum(["image/jpeg", "image/png"]),
  name: z.string().min(1).max(100),
  type: z.enum(["file"]),
  url: z.url(),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

const userMessageSchema = z.object({
  id: z.uuid(),
  parts: z.array(partSchema),
  role: z.enum(["user"]),
});

export const postRequestBodySchema = z.object({
  // 检查题卡片上选的把握
  confidence: z.enum(["guess", "somewhat", "sure"]).optional(),
  courseId: z.string().max(64).optional(),
  id: z.uuid(),
  message: userMessageSchema.optional(),
  // 回答下点了“我懂了，考我”：直接出一道独立题
  quizMe: z.boolean().optional(),
  selectedVisibilityType: z.enum(["public", "private"]),
  // 快捷按钮：给提示、直接告诉我、先不做题
  signal: z.enum(["hint", "just_tell_me", "skip"]).optional(),
  // 图谱上点了某个知识点的“开始学习”：直接以它为目标，不再归类
  targetKpId: z.string().max(64).optional(),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
