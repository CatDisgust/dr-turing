"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { usePathname } from "next/navigation";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { useDataStream } from "@/components/chat/data-stream-provider";
import { getChatHistoryPaginationKey } from "@/components/chat/sidebar-history";
import { toast } from "@/components/chat/toast";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { useAutoResume } from "@/hooks/use-auto-resume";
import {
  lastPickedCourse,
  NONE,
  rememberCourse,
  useCourses,
} from "@/hooks/use-courses";
import {
  GRADED_EVENT,
  LEARNER_REFRESH_EVENT,
  NODE_TOUCHED_EVENT,
} from "@/lib/constants";
import type { Vote } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";

type ActiveChatContextValue = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  visibilityType: VisibilityType;
  isReadonly: boolean;
  isLoading: boolean;
  votes: Vote[] | undefined;
  showCreditCardAlert: boolean;
  // 试用账号今天的消息或试用额度用完了（2026-10-24）：对话里只说明原因，不给“重试”
  limitReached: string | null;
  // 这次对话学哪门课；null = 不选课。老对话按开头选的，新对话可以换（2026-10-24 选课）
  courseId: string | null;
  // 课程列表还没取到时为 false，这时先别画课程相关的东西
  courseReady: boolean;
  pickCourse: (id: string | null) => void;
  setShowCreditCardAlert: Dispatch<SetStateAction<boolean>>;
};

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

function extractChatId(pathname: string): string | null {
  const match = pathname.match(/\/chat\/([^/]+)/);
  return match ? match[1] : null;
}

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { setDataStream, setWaitingStatus } = useDataStream();
  const { mutate } = useSWRConfig();

  const chatIdFromUrl = extractChatId(pathname);
  const isNewChat = !chatIdFromUrl;
  const newChatIdRef = useRef(generateUUID());
  const prevPathnameRef = useRef(pathname);

  if (isNewChat && prevPathnameRef.current !== pathname) {
    newChatIdRef.current = generateUUID();
  }
  prevPathnameRef.current = pathname;

  const chatId = chatIdFromUrl ?? newChatIdRef.current;

  const [input, setInput] = useState("");
  const [showCreditCardAlert, setShowCreditCardAlert] = useState(false);

  const { data: chatData, isLoading } = useSWR(
    isNewChat
      ? null
      : `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/messages?chatId=${chatId}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  // 新对话选的课：先用上次选的，没选过就用第一门课。对话一开始就以库里记的为准
  const courses = useCourses();
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (picked !== undefined || !courses) {
      return;
    }
    const last = lastPickedCourse();
    if (last === NONE) {
      setPicked(null);
    } else {
      setPicked(
        courses.find((c) => c.id === last)?.id ?? courses[0]?.id ?? null
      );
    }
  }, [courses, picked]);
  const pickCourse = useCallback((id: string | null) => {
    setPicked(id);
    rememberCourse(id);
  }, []);
  const savedCourse: string | null | undefined = isNewChat
    ? undefined
    : chatData?.courseId;
  const courseId = savedCourse === undefined ? (picked ?? null) : savedCourse;
  const courseReady = savedCourse !== undefined || picked !== undefined;
  const courseRef = useRef(courseId);
  courseRef.current = courseId;

  const initialMessages: ChatMessage[] = isNewChat
    ? []
    : (chatData?.messages ?? []);
  const visibility: VisibilityType = isNewChat
    ? "private"
    : (chatData?.visibility ?? "private");

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
    addToolApprovalResponse,
    error: chatError,
  } = useChat<ChatMessage>({
    generateId: generateUUID,
    id: chatId,
    messages: initialMessages,
    onData: (dataPart) => {
      if (dataPart.type === "data-waiting-status") {
        setWaitingStatus(dataPart.data);
        return;
      }
      if (dataPart.type === "data-graded") {
        window.dispatchEvent(
          new CustomEvent(GRADED_EVENT, { detail: dataPart.data })
        );
        return;
      }
      // 检查题卡片、小模拟是消息里的部件，由消息自己画
      if (dataPart.type === "data-check" || dataPart.type === "data-sim") {
        return;
      }
      if (dataPart.type === "data-node-touched") {
        window.dispatchEvent(
          new CustomEvent(NODE_TOUCHED_EVENT, { detail: dataPart.data })
        );
        return;
      }
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onError: (error) => {
      if (error.message?.includes("AI Gateway requires a valid credit card")) {
        setShowCreditCardAlert(true);
      } else if (error instanceof ChatbotError) {
        toast({ description: error.message, type: "error" });
      } else {
        toast({
          description: error.message || "Oops, an error occurred!",
          type: "error",
        });
      }
    },
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
      window.dispatchEvent(new Event(LEARNER_REFRESH_EVENT));
    },
    sendAutomaticallyWhen: ({ messages: currentMessages }) => {
      const lastMessage = currentMessages.at(-1);
      return (
        lastMessage?.parts?.some(
          (part) =>
            "state" in part &&
            part.state === "approval-responded" &&
            "approval" in part &&
            (part.approval as { approved?: boolean })?.approved === true
        ) ?? false
      );
    },
    transport: new DefaultChatTransport({
      api: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat`,
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        const lastMessage = request.messages.at(-1);
        const isToolApprovalContinuation =
          lastMessage?.role !== "user" ||
          request.messages.some((msg) =>
            msg.parts?.some((part) => {
              const { state } = part as { state?: string };
              return (
                state === "approval-responded" || state === "output-denied"
              );
            })
          );

        return {
          body: {
            id: request.id,
            ...(isToolApprovalContinuation
              ? { messages: request.messages }
              : { message: lastMessage }),
            courseId: courseRef.current ?? undefined,
            selectedVisibilityType: visibility,
            ...request.body,
          },
        };
      },
    }),
  });

  useEffect(() => {
    if (status === "submitted" || status === "ready" || status === "error") {
      setWaitingStatus(undefined);
    }
  }, [status, setWaitingStatus]);

  // 在这里新开、还没离开过的对话：消息就在 useChat 里，别拿库里的盖掉正在长出来的回复。
  // 离开以后再回来，就照库里的重新载入（原来一直跳过，切回刚聊过的对话会是空白）
  const bornHere = useRef(new Set<string>());
  if (isNewChat) {
    bornHere.current.add(newChatIdRef.current);
  }
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (bornHere.current.has(chatId)) {
      return;
    }
    if (
      statusRef.current === "streaming" ||
      statusRef.current === "submitted"
    ) {
      return;
    }
    if (chatData?.messages) {
      setMessages(chatData.messages);
    }
  }, [chatId, chatData?.messages, setMessages]);

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      bornHere.current.delete(prevChatIdRef.current);
      prevChatIdRef.current = chatId;
      if (isNewChat) {
        setMessages([]);
      }
    }
  }, [chatId, isNewChat, setMessages]);

  const hasAppendedQueryRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("query");
    if (query && !hasAppendedQueryRef.current) {
      hasAppendedQueryRef.current = true;
      window.history.replaceState(
        {},
        "",
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
      );
      sendMessage({
        parts: [{ text: query, type: "text" }],
        role: "user" as const,
      });
    }
  }, [sendMessage, chatId]);

  useAutoResume({
    autoResume: !isNewChat && !!chatData,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const isReadonly = isNewChat ? false : (chatData?.isReadonly ?? false);

  const { data: votes } = useSWR<Vote[]>(
    !isReadonly && messages.length >= 2
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote?chatId=${chatId}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const limitReached =
    chatError instanceof ChatbotError && chatError.type === "rate_limit"
      ? chatError.message
      : null;

  const value = useMemo<ActiveChatContextValue>(
    () => ({
      addToolApprovalResponse,
      chatId,
      courseId,
      courseReady,
      input,
      isLoading: !isNewChat && isLoading,
      isReadonly,
      limitReached,
      messages,
      pickCourse,
      regenerate,
      sendMessage,
      setInput,
      setMessages,
      setShowCreditCardAlert,
      showCreditCardAlert,
      status,
      stop,
      visibilityType: visibility,
      votes,
    }),
    [
      chatId,
      messages,
      setMessages,
      sendMessage,
      status,
      stop,
      regenerate,
      addToolApprovalResponse,
      input,
      visibility,
      isReadonly,
      isNewChat,
      isLoading,
      votes,
      showCreditCardAlert,
      limitReached,
      courseId,
      courseReady,
      pickCourse,
    ]
  );

  return (
    <ActiveChatContext.Provider value={value}>
      {children}
    </ActiveChatContext.Provider>
  );
}

export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    throw new Error("useActiveChat must be used within ActiveChatProvider");
  }
  return context;
}
