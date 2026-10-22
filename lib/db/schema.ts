import type { InferSelectModel } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  json,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type {
  Attempt,
  CourseGraph,
  LearnerState as LearnerStateData,
  PersonalGraph as PersonalGraphData,
  SessionReport,
  TutorPlan,
} from "../types";

export const user = pgTable("User", {
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  email: varchar("email", { length: 64 }).notNull(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  image: text("image"),
  isAnonymous: boolean("isAnonymous").notNull().default(false),
  name: text("name"),
  password: varchar("password", { length: 64 }),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type User = InferSelectModel<typeof user>;

export const chat = pgTable("Chat", {
  createdAt: timestamp("createdAt").notNull(),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  report: jsonb("report").$type<SessionReport>(),
  // 会后复核（D9）：复核过的会话不再补跑
  reviewedAt: timestamp("reviewedAt"),
  title: text("title").notNull(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id),
  visibility: varchar("visibility", { enum: ["public", "private"] })
    .notNull()
    .default("private"),
});

export type Chat = InferSelectModel<typeof chat>;

export const message = pgTable("Message_v2", {
  attachments: json("attachments").notNull(),
  chatId: uuid("chatId")
    .notNull()
    .references(() => chat.id),
  createdAt: timestamp("createdAt").notNull(),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  parts: json("parts").notNull(),
  // 助手消息对应的规划（D9），验收时逐条可查
  plan: jsonb("plan").$type<TutorPlan>(),
  role: varchar("role").notNull(),
});

export type DBMessage = InferSelectModel<typeof message>;

export const vote = pgTable(
  "Vote_v2",
  {
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id),
    isUpvoted: boolean("isUpvoted").notNull(),
    messageId: uuid("messageId")
      .notNull()
      .references(() => message.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chatId, table.messageId] }),
  })
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  "Document",
  {
    content: text("content"),
    createdAt: timestamp("createdAt").notNull(),
    id: uuid("id").notNull().defaultRandom(),
    kind: varchar("text", { enum: ["text", "code", "image", "sheet"] })
      .notNull()
      .default("text"),
    title: text("title").notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id, table.createdAt] }),
  })
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  "Suggestion",
  {
    createdAt: timestamp("createdAt").notNull(),
    description: text("description"),
    documentCreatedAt: timestamp("documentCreatedAt").notNull(),
    documentId: uuid("documentId").notNull(),
    id: uuid("id").notNull().defaultRandom(),
    isResolved: boolean("isResolved").notNull().default(false),
    originalText: text("originalText").notNull(),
    suggestedText: text("suggestedText").notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
    pk: primaryKey({ columns: [table.id] }),
  })
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const stream = pgTable(
  "Stream",
  {
    chatId: uuid("chatId").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    id: uuid("id").notNull().defaultRandom(),
  },
  (table) => ({
    chatRef: foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
    pk: primaryKey({ columns: [table.id] }),
  })
);

export type Stream = InferSelectModel<typeof stream>;

// 一门课一份图谱 JSON；files 记课件在 Anthropic Files API 里的 file_id
export const course = pgTable("Course", {
  files: jsonb("files").$type<string[]>().notNull(),
  graph: jsonb("graph").$type<CourseGraph>().notNull(),
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type Course = InferSelectModel<typeof course>;

// 一个学生 × 一门课一份状态（LearnerState），整份存 JSONB
export const learnerState = pgTable(
  "LearnerState",
  {
    courseId: text("courseId").notNull(),
    state: jsonb("state").$type<LearnerStateData>().notNull(),
    studentId: uuid("studentId").notNull(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.studentId, table.courseId] }),
  })
);

// 只追加的作答记录：每次批改一行，从不更新、不删除。复核撤销也只改 LearnerState，这里留原样
export const transaction = pgTable("Transaction", {
  attempt: jsonb("attempt").$type<Attempt>().notNull(),
  courseId: text("courseId").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  kpId: text("kpId").notNull(),
  messageId: uuid("messageId").notNull(),
  sessionId: uuid("sessionId").notNull(),
  studentId: uuid("studentId").notNull(),
});

// 个人图谱（D9b）：每个学生一份，跨课程。课内状态在 LearnerState，这里只放课外概念
export const personalGraph = pgTable("PersonalGraph", {
  graph: jsonb("graph").$type<PersonalGraphData>().notNull(),
  studentId: uuid("studentId").primaryKey().notNull(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});
