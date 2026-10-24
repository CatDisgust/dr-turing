import type { InferSelectModel } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  json,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { StudentDump } from "../demo/snapshot";
import type {
  Attempt,
  ConceptEventPayload,
  ConceptEventType,
  CourseGraph,
  LearnerState as LearnerStateData,
  PersonalGraph as PersonalGraphData,
  SessionReport,
  StudentEventType,
  StudentModelData,
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
  // 这次对话学哪门课；空 = 不选课，随便问（2026-10-24 选课）。开对话时定下，之后不变
  courseId: text("courseId"),
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
  // 谁传的课（第 4 步，2026-10-24）：空 = 管理员加的公开课，大家都能选；
  // 有值 = 这个同学自己传的私人课，只有他自己能看能学
  ownerId: uuid("ownerId").references(() => user.id),
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

// 个人知识库的原始记录（只追加）：提到、记错、合并、拆开。个人图谱从这里整份算出来，
// 上面的 PersonalGraph 表只在第一次读时导入旧数据用
export const conceptEvent = pgTable(
  "ConceptEvent",
  {
    at: timestamp("at").notNull().defaultNow(),
    conceptId: text("conceptId").notNull(),
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    payload: jsonb("payload").$type<ConceptEventPayload>().notNull(),
    sessionId: uuid("sessionId"),
    studentId: uuid("studentId").notNull(),
    type: varchar("type", { length: 16 }).$type<ConceptEventType>().notNull(),
  },
  (table) => [index("ConceptEvent_student_idx").on(table.studentId)]
);

// 学生的反应事件（学生建模方案 A）：放弃、跳题、听不懂、点赞点踩……只追加，从不更新、不删除。
// payload.turn 是这门课里学生的第几条消息，投入度按它衰减；复核撤销、改判带 payload.attemptId
export const event = pgTable(
  "Event",
  {
    at: timestamp("at").notNull().defaultNow(),
    courseId: text("courseId").notNull(),
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    kpId: text("kpId"),
    messageId: uuid("messageId").notNull(),
    payload: jsonb("payload")
      .$type<{ turn: number; attemptId?: string }>()
      .notNull(),
    sessionId: uuid("sessionId").notNull(),
    studentId: uuid("studentId").notNull(),
    type: varchar("type", { length: 32 }).$type<StudentEventType>().notNull(),
  },
  (table) => ({
    studentCourse: index("Event_student_course_idx").on(
      table.studentId,
      table.courseId
    ),
  })
);

export type StudentEvent = InferSelectModel<typeof event>;

// 学生模型（学生建模方案 F）：每个学生一份。除 notes 外都能由 rebuildStudentModel 从 Transaction + Event 重算
export const studentModel = pgTable("StudentModel", {
  data: jsonb("data").$type<StudentModelData>().notNull(),
  studentId: uuid("studentId").primaryKey().notNull(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

// 产品演示学生的存档（录演示视频用）：每个镜头录完存一份，重录某一镜时读回前一镜的存档
export const demoSnapshot = pgTable("DemoSnapshot", {
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  data: jsonb("data").$type<StudentDump>().notNull(),
  name: text("name").primaryKey().notNull(),
  studentId: uuid("studentId").notNull(),
});

// 试用账号（2026-10-24 用户选邀请码登录）：管理员开一个码，学生输一次就记住。
// 每个码对应一个 User；限额管理员可改
export const invite = pgTable("Invite", {
  // 试用额度：最多花多少 API 费（美分），默认 5 美元，管理员可改（2026-10-24）
  budgetCents: integer("budgetCents").notNull().default(500),
  code: text("code").primaryKey().notNull(),
  courseLimit: integer("courseLimit").notNull().default(2),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  dailyLimit: integer("dailyLimit").notNull().default(100),
  disabled: boolean("disabled").notNull().default(false),
  // 自己传课一共生成过几次（删了课再传也算），防烧钱
  generations: integer("generations").notNull().default(0),
  lastSeenAt: timestamp("lastSeenAt"),
  name: text("name").notNull(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id),
});

export type Invite = InferSelectModel<typeof invite>;

// 每个账号调 Claude 一共花了多少（微美元 = 百万分之一美元），每次调用完原子地加上
export const spend = pgTable("Spend", {
  microUsd: bigint("microUsd", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  userId: uuid("userId")
    .primaryKey()
    .notNull()
    .references(() => user.id),
});

// 试用同学点「反馈」写的一句话，管理页里看
export const feedback = pgTable("Feedback", {
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  page: text("page"),
  text: text("text").notNull(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id),
});

export type Feedback = InferSelectModel<typeof feedback>;
