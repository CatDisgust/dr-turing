import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import type { StudentDump } from "../demo/snapshot";
import { ChatbotError } from "../errors";
import type {
  ConceptEvent,
  CourseGraph,
  LearnerState,
  PersonalGraph,
  SessionReport,
  StudentModelData,
  Transaction,
} from "../types";
import { generateUUID } from "../utils";
import {
  type Chat,
  chat,
  conceptEvent,
  course,
  type DBMessage,
  demoSnapshot,
  document,
  event,
  learnerState,
  message,
  personalGraph,
  type StudentEvent,
  type Suggestion,
  stream,
  studentModel,
  suggestion,
  transaction,
  type User,
  user,
  vote,
} from "./schema";
import { generateHashedPassword } from "./utils";

const client = postgres(process.env.POSTGRES_URL ?? "");
const db = drizzle(client);

export async function getUser(email: string): Promise<User[]> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({ email, password: hashedPassword });
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function createGuestUser() {
  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  try {
    return await db.insert(user).values({ email, password }).returning({
      email: user.email,
      id: user.id,
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  try {
    return await db.insert(chat).values({
      createdAt: new Date(),
      id,
      title,
      userId,
      visibility,
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));
    await db.delete(stream).where(eq(stream.chatId, id));

    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    const userChats = await db
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.userId, userId));

    if (userChats.length === 0) {
      return { deletedCount: 0 };
    }

    const chatIds = userChats.map((c) => c.id);

    await db.delete(vote).where(inArray(vote.chatId, chatIds));
    await db.delete(message).where(inArray(message.chatId, chatIds));
    await db.delete(stream).where(inArray(stream.chatId, chatIds));

    const deletedChats = await db
      .delete(chat)
      .where(eq(chat.userId, userId))
      .returning();

    return { deletedCount: deletedChats.length };
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<unknown>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id)
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

// 我的星图的回链：一批对话的标题（只查这个学生自己的）
export async function getChatTitles({
  userId,
  ids,
}: {
  userId: string;
  ids: string[];
}): Promise<Record<string, string>> {
  if (ids.length === 0) {
    return {};
  }
  try {
    const rows = await db
      .select({ id: chat.id, title: chat.title })
      .from(chat)
      .where(and(eq(chat.userId, userId), inArray(chat.id, ids)));
    return Object.fromEntries(rows.map((r) => [r.id, r.title]));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  try {
    // 出错后点“重试”会用同一个 id 再发一次用户消息，已经存过就跳过
    return await db.insert(message).values(messages).onConflictDoNothing();
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function updateMessage({
  id,
  parts,
}: {
  id: string;
  parts: DBMessage["parts"];
}) {
  try {
    return await db.update(message).set({ parts }).where(eq(message.id, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === "up" })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      isUpvoted: type === "up",
      messageId,
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  try {
    return await db
      .insert(document)
      .values({
        content,
        createdAt: new Date(),
        id,
        kind,
        title,
        userId,
      })
      .returning();
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function updateDocumentContent({
  id,
  content,
}: {
  id: string;
  content: string;
}) {
  try {
    const docs = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt))
      .limit(1);

    const [latest] = docs;
    if (!latest) {
      throw new ChatbotError("not_found:database", "Document not found");
    }

    return await db
      .update(document)
      .set({ content })
      .where(and(eq(document.id, id), eq(document.createdAt, latest.createdAt)))
      .returning();
  } catch (error) {
    if (error instanceof ChatbotError) {
      throw error;
    }
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp)
        )
      );

    return await db
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
      .returning();
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await db
      .select()
      .from(suggestion)
      .where(eq(suggestion.documentId, documentId));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp))
      );

    const messageIds = messagesToDelete.map(
      (currentMessage) => currentMessage.id
    );

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds))
        );
    }
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  try {
    return await db.update(chat).set({ title }).where(eq(chat.id, chatId));
  } catch {
    // Best effort title update.
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  try {
    const cutoffTime = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, cutoffTime),
          eq(message.role, "user")
        )
      )
      .execute();

    return stats?.count ?? 0;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await db
      .insert(stream)
      .values({ chatId, createdAt: new Date(), id: streamId });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveCourse({
  graph,
  files,
}: {
  graph: CourseGraph;
  files: string[];
}) {
  try {
    const row = { files, graph, id: graph.courseId, name: graph.name };
    return await db
      .insert(course)
      .values(row)
      .onConflictDoUpdate({
        set: { ...row, updatedAt: new Date() },
        target: course.id,
      });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getCourseById({ id }: { id: string }) {
  try {
    const [row] = await db.select().from(course).where(eq(course.id, id));
    return row ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getLearnerState({
  studentId,
  courseId,
}: {
  studentId: string;
  courseId: string;
}) {
  try {
    const [row] = await db
      .select()
      .from(learnerState)
      .where(
        and(
          eq(learnerState.studentId, studentId),
          eq(learnerState.courseId, courseId)
        )
      );
    return row?.state ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveLearnerState({ state }: { state: LearnerState }) {
  try {
    const row = {
      courseId: state.courseId,
      state,
      studentId: state.studentId,
    };
    return await db
      .insert(learnerState)
      .values(row)
      .onConflictDoUpdate({
        set: { state, updatedAt: new Date() },
        target: [learnerState.studentId, learnerState.courseId],
      });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

// ---- D9：作答记录、会后复核 ----

export async function saveTransaction(row: Transaction) {
  try {
    return await db.insert(transaction).values(row);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getTransactionsBySession({
  sessionId,
}: {
  sessionId: string;
}) {
  try {
    return await db
      .select()
      .from(transaction)
      .where(eq(transaction.sessionId, sessionId))
      .orderBy(asc(transaction.createdAt));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

// 还没复核过的旧会话，新的在前；开新对话时补跑
export async function getUnreviewedChats({
  userId,
  exceptId,
  limit,
}: {
  userId: string;
  exceptId: string;
  limit: number;
}) {
  try {
    const rows = await db
      .select()
      .from(chat)
      .where(and(eq(chat.userId, userId), isNull(chat.reviewedAt)))
      .orderBy(desc(chat.createdAt))
      .limit(limit + 1);
    return rows.filter((row) => row.id !== exceptId).slice(0, limit);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveChatReport({
  id,
  report,
}: {
  id: string;
  report: SessionReport;
}) {
  try {
    return await db
      .update(chat)
      .set({ report, reviewedAt: new Date(report.reviewedAt) })
      .where(eq(chat.id, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

// 结束后学生又在同一个对话里说话：撤掉复核标记，下次结束或补跑时再复核新的证据
export async function reopenChat({ id }: { id: string }) {
  try {
    return await db
      .update(chat)
      .set({ report: null, reviewedAt: null })
      .where(eq(chat.id, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

// ---- D9b：个人图谱 ----

export async function getPersonalGraph({ studentId }: { studentId: string }) {
  try {
    const [row] = await db
      .select()
      .from(personalGraph)
      .where(eq(personalGraph.studentId, studentId));
    return row?.graph ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function savePersonalGraph({ graph }: { graph: PersonalGraph }) {
  try {
    return await db
      .insert(personalGraph)
      .values({ graph, studentId: graph.studentId })
      .onConflictDoUpdate({
        set: { graph, updatedAt: new Date() },
        target: personalGraph.studentId,
      });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

// 一个学生在所有课上的状态：底层能力跨课程统计
export async function getLearnerStatesByStudent({
  studentId,
}: {
  studentId: string;
}) {
  try {
    const rows = await db
      .select()
      .from(learnerState)
      .where(eq(learnerState.studentId, studentId));
    return rows.map((row) => row.state);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

// 学生的反应事件：只追加
export async function saveEvents(rows: Omit<StudentEvent, "id" | "at">[]) {
  if (rows.length === 0) {
    return;
  }
  try {
    return await db.insert(event).values(rows);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getEventsByStudent({ studentId }: { studentId: string }) {
  try {
    return await db
      .select()
      .from(event)
      .where(eq(event.studentId, studentId))
      .orderBy(asc(event.at));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getTransactionsByStudent({
  studentId,
}: {
  studentId: string;
}) {
  try {
    return await db
      .select()
      .from(transaction)
      .where(eq(transaction.studentId, studentId))
      .orderBy(asc(transaction.createdAt));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getStudentModel({ studentId }: { studentId: string }) {
  try {
    const [row] = await db
      .select()
      .from(studentModel)
      .where(eq(studentModel.studentId, studentId));
    return row?.data ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveStudentModel({
  studentId,
  data,
}: {
  studentId: string;
  data: StudentModelData;
}) {
  try {
    return await db
      .insert(studentModel)
      .values({ data, studentId })
      .onConflictDoUpdate({
        set: { data, updatedAt: new Date() },
        target: studentModel.studentId,
      });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

// 讲法效果（学生建模方案 C）要用：这个学生所有对话里的消息，只取时间、角色和规划，不取正文
export async function getPlanMessagesByStudent({
  studentId,
}: {
  studentId: string;
}) {
  try {
    return await db
      .select({
        chatId: message.chatId,
        createdAt: message.createdAt,
        id: message.id,
        plan: message.plan,
        role: message.role,
      })
      .from(message)
      .innerJoin(chat, eq(chat.id, message.chatId))
      .where(eq(chat.userId, studentId))
      .orderBy(asc(message.createdAt));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

// 冷启动先验要用：其他学生的学生模型
export async function getOtherStudentModels({
  studentId,
}: {
  studentId: string;
}) {
  try {
    const rows = await db
      .select({ data: studentModel.data })
      .from(studentModel)
      .where(ne(studentModel.studentId, studentId));
    return rows.map((r) => r.data);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

// 个人知识库的原始记录（只追加），按时间顺序
export async function getConceptEvents({
  studentId,
}: {
  studentId: string;
}): Promise<ConceptEvent[]> {
  try {
    const rows = await db
      .select()
      .from(conceptEvent)
      .where(eq(conceptEvent.studentId, studentId))
      .orderBy(asc(conceptEvent.at), asc(conceptEvent.id));
    return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveConceptEvents(events: ConceptEvent[]) {
  if (events.length === 0) {
    return;
  }
  try {
    await db
      .insert(conceptEvent)
      .values(events.map((e) => ({ ...e, at: new Date(e.at) })));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

// 产品演示学生一键重来：这个学生的对话、课内状态、作答和事件记录、学生模型、个人知识库全部删掉。
// 只追加的表平时从不删，这里是演示专用的例外，只给产品演示学生用
export async function resetStudent({ studentId }: { studentId: string }) {
  try {
    await deleteAllChatsByUserId({ userId: studentId });
    await db.delete(learnerState).where(eq(learnerState.studentId, studentId));
    await db.delete(transaction).where(eq(transaction.studentId, studentId));
    await db.delete(event).where(eq(event.studentId, studentId));
    await db.delete(studentModel).where(eq(studentModel.studentId, studentId));
    await db.delete(conceptEvent).where(eq(conceptEvent.studentId, studentId));
    await db
      .delete(personalGraph)
      .where(eq(personalGraph.studentId, studentId));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

// 产品演示学生的全部记录整份导出（存档用）。时间列转成 ISO 字符串，整份能直接存进 JSONB
export async function dumpStudent({
  studentId,
}: {
  studentId: string;
}): Promise<StudentDump> {
  try {
    const chats = await db
      .select()
      .from(chat)
      .where(eq(chat.userId, studentId));
    const chatIds = chats.map((c) => c.id);
    const [
      messages,
      votes,
      learnerStates,
      transactions,
      events,
      studentModels,
      conceptEvents,
      personalGraphs,
    ] = await Promise.all([
      chatIds.length > 0
        ? db.select().from(message).where(inArray(message.chatId, chatIds))
        : [],
      chatIds.length > 0
        ? db.select().from(vote).where(inArray(vote.chatId, chatIds))
        : [],
      db
        .select()
        .from(learnerState)
        .where(eq(learnerState.studentId, studentId)),
      db.select().from(transaction).where(eq(transaction.studentId, studentId)),
      db.select().from(event).where(eq(event.studentId, studentId)),
      db
        .select()
        .from(studentModel)
        .where(eq(studentModel.studentId, studentId)),
      db
        .select()
        .from(conceptEvent)
        .where(eq(conceptEvent.studentId, studentId)),
      db
        .select()
        .from(personalGraph)
        .where(eq(personalGraph.studentId, studentId)),
    ]);
    return JSON.parse(
      JSON.stringify({
        chats,
        conceptEvents,
        events,
        learnerStates,
        messages,
        personalGraphs,
        studentModels,
        transactions,
        votes,
      })
    ) as StudentDump;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

// 时间列从存档里的字符串变回 Date，其余原样
function withDates<T>(rows: Record<string, unknown>[], keys: string[]): T[] {
  return rows.map(
    (row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          keys.includes(k) && typeof v === "string" ? new Date(v) : v,
        ])
      ) as T
  );
}

// 把存档整份写回：先删掉这个学生现在的全部记录，再按存档插回去，一个事务里做完
export async function restoreStudent({
  studentId,
  dump,
}: {
  studentId: string;
  dump: StudentDump;
}) {
  try {
    await db.transaction(async (tx) => {
      const current = await tx
        .select({ id: chat.id })
        .from(chat)
        .where(eq(chat.userId, studentId));
      const ids = current.map((c) => c.id);
      if (ids.length > 0) {
        await tx.delete(vote).where(inArray(vote.chatId, ids));
        await tx.delete(message).where(inArray(message.chatId, ids));
        await tx.delete(stream).where(inArray(stream.chatId, ids));
        await tx.delete(chat).where(inArray(chat.id, ids));
      }
      await tx
        .delete(learnerState)
        .where(eq(learnerState.studentId, studentId));
      await tx.delete(transaction).where(eq(transaction.studentId, studentId));
      await tx.delete(event).where(eq(event.studentId, studentId));
      await tx
        .delete(studentModel)
        .where(eq(studentModel.studentId, studentId));
      await tx
        .delete(conceptEvent)
        .where(eq(conceptEvent.studentId, studentId));
      await tx
        .delete(personalGraph)
        .where(eq(personalGraph.studentId, studentId));

      if (dump.chats.length > 0) {
        await tx
          .insert(chat)
          .values(
            withDates<typeof chat.$inferInsert>(dump.chats, [
              "createdAt",
              "reviewedAt",
            ])
          );
      }
      if (dump.messages.length > 0) {
        await tx
          .insert(message)
          .values(
            withDates<typeof message.$inferInsert>(dump.messages, ["createdAt"])
          );
      }
      if (dump.votes.length > 0) {
        await tx
          .insert(vote)
          .values(withDates<typeof vote.$inferInsert>(dump.votes, []));
      }
      if (dump.learnerStates.length > 0) {
        await tx
          .insert(learnerState)
          .values(
            withDates<typeof learnerState.$inferInsert>(dump.learnerStates, [
              "updatedAt",
            ])
          );
      }
      if (dump.transactions.length > 0) {
        await tx
          .insert(transaction)
          .values(
            withDates<typeof transaction.$inferInsert>(dump.transactions, [
              "createdAt",
            ])
          );
      }
      if (dump.events.length > 0) {
        await tx
          .insert(event)
          .values(withDates<typeof event.$inferInsert>(dump.events, ["at"]));
      }
      if (dump.studentModels.length > 0) {
        await tx
          .insert(studentModel)
          .values(
            withDates<typeof studentModel.$inferInsert>(dump.studentModels, [
              "updatedAt",
            ])
          );
      }
      if (dump.conceptEvents.length > 0) {
        await tx
          .insert(conceptEvent)
          .values(
            withDates<typeof conceptEvent.$inferInsert>(dump.conceptEvents, [
              "at",
            ])
          );
      }
      if (dump.personalGraphs.length > 0) {
        await tx
          .insert(personalGraph)
          .values(
            withDates<typeof personalGraph.$inferInsert>(dump.personalGraphs, [
              "updatedAt",
            ])
          );
      }
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveDemoSnapshot({
  name,
  studentId,
  data,
}: {
  name: string;
  studentId: string;
  data: StudentDump;
}) {
  try {
    await db
      .insert(demoSnapshot)
      .values({ createdAt: new Date(), data, name, studentId })
      .onConflictDoUpdate({
        set: { createdAt: new Date(), data, studentId },
        target: demoSnapshot.name,
      });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getDemoSnapshot({ name }: { name: string }) {
  try {
    const [row] = await db
      .select()
      .from(demoSnapshot)
      .where(eq(demoSnapshot.name, name));
    return row ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function listDemoSnapshots() {
  try {
    return await db
      .select({ createdAt: demoSnapshot.createdAt, name: demoSnapshot.name })
      .from(demoSnapshot)
      .orderBy(asc(demoSnapshot.createdAt));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}
