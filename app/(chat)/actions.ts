"use server";

import type { UIMessage } from "ai";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { titlePrompt } from "@/lib/ai/prompts";
import { claude, MODEL, TIERS } from "@/lib/claude";
import {
  deleteMessagesByChatIdAfterTimestamp,
  getChatById,
  getMessageById,
  updateChatVisibilityById,
} from "@/lib/db/queries";
import { auth } from "@/lib/session";
import { recordUsage } from "@/lib/spend";
import { getTextFromMessage } from "@/lib/utils";

export async function generateTitleFromUserMessage({
  message,
}: {
  message: UIMessage;
}) {
  const response = await claude.messages.create({
    max_tokens: 1000,
    messages: [{ content: getTextFromMessage(message), role: "user" }],
    model: MODEL,
    output_config: { effort: TIERS.fast.effort },
    system: titlePrompt,
  });
  recordUsage(response.model, response.usage);
  const text = response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  return text
    .replace(/^[#*"\s]+/, "")
    .replace(/["]+$/, "")
    .trim();
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const [message] = await getMessageById({ id });
  if (!message) {
    throw new Error("Message not found");
  }

  const chat = await getChatById({ id: message.chatId });
  if (!chat || chat.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
  });
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const chat = await getChatById({ id: chatId });
  if (!chat || chat.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }

  await updateChatVisibilityById({ chatId, visibility });
}
