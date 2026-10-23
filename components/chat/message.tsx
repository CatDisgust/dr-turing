"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { MessageContent, MessageResponse } from "../ai-elements/message";
import { Shimmer } from "../ai-elements/shimmer";
import { CheckCardView } from "./check-card";
import { useDataStream } from "./data-stream-provider";
import { DeadlockSim } from "./deadlock-sim";
import { FollowUps } from "./follow-ups";
import { GradedLine } from "./graded-line";
import { MessageActions } from "./message-actions";
import { MessageReasoning } from "./message-reasoning";
import { PlanBadge, TimingLine } from "./plan-badge";
import { PreviewAttachment } from "./preview-attachment";

function WaitingText() {
  const { waitingStatus } = useDataStream();
  const waitingText = waitingStatus?.message ?? "思考中…";

  return (
    <div className="flex min-h-[calc(16px*1.75)] min-w-0 items-center text-[15px] text-muted-foreground leading-[1.75]">
      <Shimmer
        as="span"
        className="font-medium whitespace-normal break-words"
        duration={1}
      >
        {waitingText}
      </Shimmer>
    </div>
  );
}

const PurePreviewMessage = ({
  addToolApprovalResponse: _addToolApprovalResponse,
  chatId,
  message,
  vote,
  isLoading,
  setMessages: _setMessages,
  regenerate: _regenerate,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
  onEdit,
  isLatest = false,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  onEdit?: (message: ChatMessage) => void;
  // 最后一条消息：只有它里面的检查题卡片能答、下面才有追问按钮
  isLatest?: boolean;
}) => {
  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );

  useDataStream();

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const hasAnyContent = message.parts?.some(
    (part) =>
      (part.type === "text" && part.text?.trim().length > 0) ||
      (part.type === "reasoning" &&
        "text" in part &&
        part.text?.trim().length > 0)
  );
  const isThinking = isAssistant && isLoading && !hasAnyContent;

  const attachments = attachmentsFromMessage.length > 0 && (
    <div
      className="flex flex-row justify-end gap-2"
      data-testid={"message-attachments"}
    >
      {attachmentsFromMessage.map((attachment) => (
        <PreviewAttachment
          attachment={{
            contentType: attachment.mediaType,
            name: attachment.filename ?? "file",
            url: attachment.url,
          }}
          key={attachment.url}
        />
      ))}
    </div>
  );

  const mergedReasoning = message.parts?.reduce(
    (acc, part) => {
      if (part.type === "reasoning" && part.text?.trim().length > 0) {
        return {
          isStreaming: "state" in part ? part.state === "streaming" : false,
          rendered: false,
          text: acc.text ? `${acc.text}\n\n${part.text}` : part.text,
        };
      }
      return acc;
    },
    { isStreaming: false, rendered: false, text: "" }
  ) ?? { isStreaming: false, rendered: false, text: "" };

  const parts = message.parts?.map((part, index) => {
    const { type } = part;
    const key = `message-${message.id}-part-${index}`;

    if (type === "reasoning") {
      if (!mergedReasoning.rendered && mergedReasoning.text) {
        mergedReasoning.rendered = true;
        return (
          <MessageReasoning
            isLoading={isLoading || mergedReasoning.isStreaming}
            key={key}
            reasoning={mergedReasoning.text}
          />
        );
      }
      return null;
    }

    // 批改结果单独放在最上面，见下面的 verdict
    if (type === "data-graded") {
      return null;
    }

    if (type === "data-sim") {
      return <DeadlockSim key={key} />;
    }

    if (type === "data-check") {
      return <CheckCardView card={part.data} key={key} />;
    }

    if (type === "text") {
      return (
        <MessageContent
          className={cn(
            isUser
              ? "w-fit max-w-[70%] overflow-hidden break-words rounded-2xl bg-secondary px-4 py-2 text-[15px] leading-[1.6] [&_p]:leading-[1.6]"
              : "text-[16px] leading-[1.75] [&_p]:leading-[1.75] [&_strong]:font-bold"
          )}
          data-quote-source={isAssistant ? "导师刚才说的" : undefined}
          data-testid="message-content"
          key={key}
        >
          <MessageResponse>{sanitizeText(part.text)}</MessageResponse>
        </MessageContent>
      );
    }

    return null;
  });

  const verdict = message.parts?.map((part) =>
    part.type === "data-graded" ? (
      <GradedLine graded={part.data} key={`graded-${part.data.kpId}`} />
    ) : null
  );

  const actions = !isReadonly && (
    <MessageActions
      chatId={chatId}
      isLoading={isLoading}
      key={`action-${message.id}`}
      message={message}
      onEdit={onEdit ? () => onEdit(message) : undefined}
      vote={vote}
    />
  );

  // 讲完、没留题的回答下面摆追问按钮（交互方案 E）
  const showFollowUps =
    isAssistant &&
    isLatest &&
    !isLoading &&
    !isReadonly &&
    Boolean(message.metadata?.plan) &&
    !message.parts.some((part) => part.type === "data-check");

  const content = isThinking ? (
    <WaitingText />
  ) : (
    <>
      {verdict}
      {message.metadata?.plan ? (
        <PlanBadge
          plan={message.metadata.plan}
          timing={message.metadata.timing}
        />
      ) : message.metadata?.timing ? (
        <TimingLine timing={message.metadata.timing} />
      ) : null}
      {attachments}
      {parts}
      {showFollowUps ? <FollowUps /> : null}
      {actions}
    </>
  );

  return (
    <div
      className={cn(
        "group/message w-full",
        !isAssistant && "animate-[fade-up_0.25s_cubic-bezier(0.22,1,0.36,1)]"
      )}
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn(
          isUser ? "flex flex-col items-end gap-2" : "flex items-start gap-3"
        )}
      >
        {isAssistant ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">{content}</div>
        ) : (
          content
        )}
      </div>
    </div>
  );
};

export const PreviewMessage = PurePreviewMessage;

export const ThinkingMessage = () => (
  <div
    className="group/message w-full"
    data-role="assistant"
    data-testid="message-assistant-loading"
  >
    <WaitingText />
  </div>
);
