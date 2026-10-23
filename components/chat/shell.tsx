"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LearnerGraph } from "@/components/graph/learner-graph";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useActiveChat } from "@/hooks/use-active-chat";
import {
  initialArtifactData,
  useArtifact,
  useArtifactSelector,
} from "@/hooks/use-artifact";
import { COURSE_ID, LEARNER_REFRESH_EVENT } from "@/lib/constants";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Artifact } from "./artifact";
import { ChatHeader } from "./chat-header";
import { DataStreamHandler } from "./data-stream-handler";
import { MaterialPane } from "./material-pane";
import { submitEditedMessage } from "./message-editor";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { ASK_QUESTION, SelectionMenu } from "./selection-menu";
import { SideDrawer } from "./side-drawer";
import { type SendBody, TutorActionsProvider } from "./tutor-actions";

export function ChatShell() {
  const {
    chatId,
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    addToolApprovalResponse,
    input,
    setInput,
    visibilityType,
    isReadonly,
    isLoading,
    votes,
    showCreditCardAlert,
    setShowCreditCardAlert,
  } = useActiveChat();

  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(
    null
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const { setArtifact } = useArtifact();

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      stopRef.current();
      setArtifact(initialArtifactData);
      setEditingMessage(null);
      setAttachments([]);
    }
  }, [chatId, setArtifact]);

  // 开新对话：之前没点“结束本次学习”的会话在后台补跑复核，跑完刷新图谱
  const isNewChat = messages.length === 0;
  useEffect(() => {
    if (!isNewChat || isReadonly) {
      return;
    }
    fetch("/api/session/catch-up", {
      body: JSON.stringify({ courseId: COURSE_ID, exceptChatId: chatId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
      .then(() => window.dispatchEvent(new Event(LEARNER_REFRESH_EVENT)))
      .catch(() => {
        /* 补跑失败下次再补 */
      });
  }, [chatId, isNewChat, isReadonly]);

  const handleEditMessage = useCallback(
    (msg: ChatMessage) => {
      const text = msg.parts
        ?.filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
      setInput(text ?? "");
      setEditingMessage(msg);
    },
    [setInput]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setInput("");
  }, [setInput]);

  const handleSendEditedMessage = useCallback(async () => {
    if (!editingMessage) {
      return;
    }

    const msg = editingMessage;
    setEditingMessage(null);
    await submitEditedMessage({
      message: msg,
      regenerate,
      setMessages,
      text: input,
    });
    setInput("");
  }, [editingMessage, input, regenerate, setInput, setMessages]);

  // 划词后把引用放进输入框开头，学生改好再发；select 给出要选中的那段（方便直接改写）
  const fillInput = useCallback(
    (quote: string, question: string) => {
      const head = `${quote}${question}`;
      const text = input ? `${head}\n${input}` : head;
      setInput(text);
      const box = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="multimodal-input"]'
      );
      setTimeout(() => {
        box?.focus();
        box?.setSelectionRange(quote.length, head.length);
      }, 0);
    },
    [input, setInput]
  );
  // “问这句”：带上默认问题并选中它，直接回车就问“这句是什么意思”，打字就换成自己的问题
  const handleAsk = useCallback(
    (quote: string) => fillInput(quote, ASK_QUESTION),
    [fillInput]
  );
  // “引用回复”：只放引用，光标停在后面接着写
  const handleQuote = useCallback(
    (quote: string) => fillInput(quote, ""),
    [fillInput]
  );

  // 回答里的部件（检查题卡片、追问按钮）：发一句话，同时告诉服务端是哪种操作
  const handleSend = useCallback(
    (text: string, body?: SendBody) => {
      sendMessage(
        { parts: [{ text, type: "text" }], role: "user" },
        body ? { body } : undefined
      );
    },
    [sendMessage]
  );
  // 小模拟做完：把句子开头放进输入框，学生接着写
  const handleFill = useCallback(
    (text: string) => fillInput(text, ""),
    [fillInput]
  );
  const busy = status === "submitted" || status === "streaming";
  const tutorActions = useMemo(
    () => ({
      disabled: isReadonly || busy,
      fillInput: handleFill,
      send: handleSend,
    }),
    [busy, handleFill, handleSend, isReadonly]
  );

  // 图谱上点“开始学习”：发一句话，并告诉服务端目标点，不用再归类
  const handleStartLearning = useCallback(
    (kpId: string, name: string) => {
      window.history.pushState(
        {},
        "",
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
      );
      sendMessage(
        { parts: [{ text: `我想学「${name}」`, type: "text" }], role: "user" },
        { body: { targetKpId: kpId } }
      );
    },
    [chatId, sendMessage]
  );

  const handleActivateGateway = useCallback(() => {
    window.open(
      "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card",
      "_blank"
    );
    window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;
  }, []);

  return (
    <>
      <div className="flex h-dvh w-full flex-row overflow-hidden">
        <div
          className={cn(
            "flex min-w-0 flex-col bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
            isArtifactVisible ? "w-[40%]" : "w-full min-w-0 flex-1"
          )}
        >
          <ChatHeader
            canEnd={messages.length > 0 && status === "ready"}
            chatId={chatId}
            isReadonly={isReadonly}
            selectedVisibilityType={visibilityType}
          />

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-tl-[12px] md:border-t md:border-l md:border-border/40">
            <TutorActionsProvider value={tutorActions}>
              <Messages
                addToolApprovalResponse={addToolApprovalResponse}
                chatId={chatId}
                isArtifactVisible={isArtifactVisible}
                isLoading={isLoading}
                isReadonly={isReadonly}
                messages={messages}
                onEditMessage={handleEditMessage}
                regenerate={regenerate}
                setMessages={setMessages}
                status={status}
                votes={votes}
              />
            </TutorActionsProvider>

            <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl flex-col gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
              {!isReadonly && (
                <MultimodalInput
                  attachments={attachments}
                  chatId={chatId}
                  editingMessage={editingMessage}
                  input={input}
                  isLoading={isLoading}
                  messages={messages}
                  onCancelEdit={handleCancelEdit}
                  selectedVisibilityType={visibilityType}
                  sendMessage={
                    editingMessage ? handleSendEditedMessage : sendMessage
                  }
                  setAttachments={setAttachments}
                  setInput={setInput}
                  setMessages={setMessages}
                  status={status}
                  stop={stop}
                />
              )}
            </div>
          </div>
        </div>

        {!isArtifactVisible && (
          <SideDrawer
            graph={
              <LearnerGraph
                key={chatId}
                onStartLearning={
                  isReadonly || status === "submitted" || status === "streaming"
                    ? undefined
                    : handleStartLearning
                }
                sessionId={chatId}
              />
            }
            material={<MaterialPane />}
            showMaterial={!isReadonly}
          />
        )}
        <SelectionMenu
          disabled={
            isReadonly || status === "submitted" || status === "streaming"
          }
          onAsk={handleAsk}
          onQuote={handleQuote}
        />

        <Artifact
          addToolApprovalResponse={addToolApprovalResponse}
          attachments={attachments}
          chatId={chatId}
          input={input}
          isReadonly={isReadonly}
          messages={messages}
          regenerate={regenerate}
          selectedVisibilityType={visibilityType}
          sendMessage={sendMessage}
          setAttachments={setAttachments}
          setInput={setInput}
          setMessages={setMessages}
          status={status}
          stop={stop}
          votes={votes}
        />
      </div>

      <DataStreamHandler />

      <AlertDialog
        onOpenChange={setShowCreditCardAlert}
        open={showCreditCardAlert}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate AI Gateway</AlertDialogTitle>
            <AlertDialogDescription>
              This application requires{" "}
              {process.env.NODE_ENV === "production" ? "the owner" : "you"} to
              activate Vercel AI Gateway.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleActivateGateway}>
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
