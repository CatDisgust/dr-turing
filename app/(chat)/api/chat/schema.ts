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
  courseId: z.string().max(64).optional(),
  id: z.uuid(),
  message: userMessageSchema.optional(),
  selectedVisibilityType: z.enum(["public", "private"]),
  // 快捷按钮：给提示、直接告诉我、先不做题
  signal: z.enum(["hint", "just_tell_me", "skip"]).optional(),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
