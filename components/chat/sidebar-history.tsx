"use client";

import { motion } from "framer-motion";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import useSWRInfinite from "swr/infinite";
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
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  useSidebar,
} from "@/components/ui/sidebar";
import { useActiveChat } from "@/hooks/use-active-chat";
import {
  type CourseOption,
  useCourses,
  useOwnUpload,
} from "@/hooks/use-courses";
import type { Chat } from "@/lib/db/schema";
import type { User } from "@/lib/session";
import { fetcher } from "@/lib/utils";
import { LoaderIcon } from "./icons";
import { ChatItem } from "./sidebar-history-item";

export type ChatHistory = {
  chats: Chat[];
  hasMore: boolean;
};

// 一页取 50 个（接口上限），对话按课分组，翻页前每门课的对话基本都在第一页里
const PAGE_SIZE = 50;
// 每门课先显示最近几个对话，多的点「再显示」
const SHOWN = 5;

export function getChatHistoryPaginationKey(
  pageIndex: number,
  previousPageData: ChatHistory
) {
  if (previousPageData && previousPageData.hasMore === false) {
    return null;
  }

  if (pageIndex === 0) {
    return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history?limit=${PAGE_SIZE}`;
  }

  const firstChatFromPage = previousPageData.chats.at(-1);

  if (!firstChatFromPage) {
    return null;
  }

  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history?ending_before=${firstChatFromPage.id}&limit=${PAGE_SIZE}`;
}

// 侧边栏「我的课」+「随便问」（2026-10-24，课程当文件夹）：点课名在这门课开新对话，
// 展开看这门课的旧对话；对话的课一开始就定了，换课就是去另一门课开新对话
export function SidebarHistory({ user }: { user: User | undefined }) {
  const { setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const id = pathname?.startsWith("/chat/") ? pathname.split("/")[2] : null;
  const courses = useCourses();
  const own = useOwnUpload();
  const { courseId, courseReady, pickCourse } = useActiveChat();

  const {
    data: paginatedChatHistories,
    setSize,
    isValidating,
    isLoading,
    mutate,
  } = useSWRInfinite<ChatHistory>(
    user ? getChatHistoryPaginationKey : () => null,
    fetcher,
    { fallbackData: [], revalidateOnFocus: false }
  );

  const router = useRouter();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // 展开了哪几门课；正在学的那门自动展开
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (courseReady && courseId) {
      setOpen((current) =>
        current.has(courseId) ? current : new Set(current).add(courseId)
      );
    }
  }, [courseId, courseReady]);
  const toggle = useCallback((course: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(course)) {
        next.delete(course);
      } else {
        next.add(course);
      }
      return next;
    });
  }, []);

  const start = useCallback(
    (course: string | null) => {
      pickCourse(course);
      setOpenMobile(false);
      if (pathname !== "/") {
        router.push("/");
      }
    },
    [pathname, pickCourse, router, setOpenMobile]
  );

  const hasReachedEnd = paginatedChatHistories
    ? paginatedChatHistories.some((page) => page.hasMore === false)
    : false;

  const handleDelete = useCallback(() => {
    const chatToDelete = deleteId;
    const isCurrentChat = pathname === `/chat/${chatToDelete}`;

    setShowDeleteDialog(false);

    if (isCurrentChat) {
      router.replace("/");
    }

    mutate((chatHistories) => {
      if (chatHistories) {
        return chatHistories.map((chatHistory) => ({
          ...chatHistory,
          chats: chatHistory.chats.filter((chat) => chat.id !== chatToDelete),
        }));
      }
    });

    fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat?id=${chatToDelete}`,
      { method: "DELETE" }
    );

    toast.success("对话已删掉");
  }, [deleteId, mutate, pathname, router]);

  const handleShowDeleteDialog = useCallback((chatId: string) => {
    setDeleteId(chatId);
    setShowDeleteDialog(true);
  }, []);

  const handleViewportEnter = useCallback(() => {
    if (!isValidating && !hasReachedEnd) {
      setSize((size) => size + 1);
    }
  }, [hasReachedEnd, isValidating, setSize]);

  if (!user) {
    return null;
  }

  const chats = (paginatedChatHistories ?? []).flatMap((page) => page.chats);
  const known = new Set((courses ?? []).map((c) => c.id));
  // 课被删了的老对话也放进「随便问」，别丢
  const free = chats.filter((c) => !(c.courseId && known.has(c.courseId)));
  const onCourse = courseReady ? courseId : undefined;

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="text-[12px] font-semibold text-sidebar-foreground/70">
          我的课
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu data-testid="sidebar-courses">
            {courses === null ? (
              <div className="h-8 animate-pulse rounded-md bg-sidebar-foreground/[0.06]" />
            ) : null}
            {courses?.map((course) => (
              <CourseFolder
                activeChat={id}
                chats={chats.filter((c) => c.courseId === course.id)}
                course={course}
                current={onCourse === course.id}
                key={course.id}
                loading={isLoading}
                onDelete={handleShowDeleteDialog}
                onStart={start}
                onToggle={toggle}
                open={open.has(course.id)}
              />
            ))}
            {own ? (
              <li>
                <a
                  className="flex items-center gap-1 rounded-lg py-1.5 pl-2 text-[13px] text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  data-testid="upload-own"
                  href="/my-course"
                  title="传自己的课件，生成一门只有你能看到的课"
                >
                  <PlusIcon aria-hidden className="size-3.5 shrink-0" />
                  上传我的课（{own.count}/{own.limit}）
                </a>
              </li>
            ) : null}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <div className="flex items-center justify-between">
          <SidebarGroupLabel className="text-[12px] font-semibold text-sidebar-foreground/70">
            随便问（不选课）
          </SidebarGroupLabel>
          <NewFreeChat current={onCourse === null} onStart={start} />
        </div>
        <SidebarGroupContent>
          <SidebarMenu data-testid="sidebar-free">
            <ChatList
              activeChat={id}
              chats={free}
              empty={isLoading ? "" : "还没有。和课无关的问题点 ＋ 来问。"}
              onDelete={handleShowDeleteDialog}
            />
          </SidebarMenu>

          <motion.div onViewportEnter={handleViewportEnter} />

          {hasReachedEnd ? null : (
            <div className="mt-1 flex flex-row items-center gap-2 px-4 py-2 text-sidebar-foreground/50">
              <div className="animate-spin">
                <LoaderIcon />
              </div>
              <div className="text-[11px]">加载中…</div>
            </div>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <AlertDialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删掉这个对话？</AlertDialogTitle>
            <AlertDialogDescription>
              对话和里面的消息会删掉，找不回来。你在这次对话里答过的题、学到的星星还会留在星图里。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>删掉</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CourseFolder({
  loading,
  course,
  chats,
  open,
  current,
  activeChat,
  onToggle,
  onStart,
  onDelete,
}: {
  loading: boolean;
  course: CourseOption;
  chats: Chat[];
  open: boolean;
  current: boolean;
  activeChat: string | null;
  onToggle: (id: string) => void;
  onStart: (id: string | null) => void;
  onDelete: (chatId: string) => void;
}) {
  const toggle = useCallback(() => onToggle(course.id), [onToggle, course.id]);
  const start = useCallback(() => onStart(course.id), [onStart, course.id]);
  return (
    <li className="flex flex-col" data-testid={`folder-${course.id}`}>
      <div
        className={`group/folder flex items-center gap-1 rounded-lg pr-1 ${current ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50"}`}
      >
        <button
          aria-expanded={open}
          aria-label={open ? "收起这门课的对话" : "展开这门课的对话"}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground"
          onClick={toggle}
          type="button"
        >
          <ChevronRightIcon
            className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`}
          />
        </button>
        <button
          className={`min-w-0 flex-1 truncate py-1.5 text-left text-[13px] ${current ? "font-semibold text-sidebar-foreground" : "text-sidebar-foreground/80"}`}
          data-testid={`course-${course.id}`}
          onClick={start}
          title={`在「${course.name}」开一个新对话`}
          type="button"
        >
          {course.name}
        </button>
        {course.mine ? (
          <span
            className="shrink-0 rounded-full border border-sidebar-border px-1.5 text-[11px] text-sidebar-foreground/60"
            data-testid={`mine-${course.id}`}
            title="你自己传的课，只有你能看到"
          >
            我的
          </span>
        ) : null}
        {course.due > 0 ? (
          <span
            className="shrink-0 rounded-full bg-[var(--duo-blue-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--duo-blue-ink)]"
            data-testid={`due-${course.id}`}
            title="这些点隔了一阵还没全亮，回来自己答一遍就会更亮"
          >
            待复习 {course.due}
          </span>
        ) : null}
        <PlusIcon
          aria-hidden
          className="size-3.5 shrink-0 text-sidebar-foreground/40 opacity-0 group-hover/folder:opacity-100"
        />
      </div>
      {open ? (
        <ul className="ml-4 border-l border-sidebar-border pl-1">
          <ChatList
            activeChat={activeChat}
            chats={chats}
            empty={loading ? "" : "还没有对话，点课名开始。"}
            onDelete={onDelete}
          />
        </ul>
      ) : null}
    </li>
  );
}

function NewFreeChat({
  current,
  onStart,
}: {
  current: boolean;
  onStart: (id: string | null) => void;
}) {
  const start = useCallback(() => onStart(null), [onStart]);
  return (
    <button
      aria-label="不选课，开一个新对话"
      aria-pressed={current}
      className={`mr-2 flex size-6 items-center justify-center rounded-md ${current ? "bg-sidebar-accent text-sidebar-foreground" : "text-sidebar-foreground/50 hover:text-sidebar-foreground"}`}
      data-testid="course-none"
      onClick={start}
      title="不选课，开一个新对话"
      type="button"
    >
      <PlusIcon className="size-4" />
    </button>
  );
}

function ChatList({
  chats,
  activeChat,
  empty,
  onDelete,
}: {
  chats: Chat[];
  activeChat: string | null;
  empty: string;
  onDelete: (chatId: string) => void;
}) {
  const { setOpenMobile } = useSidebar();
  const [all, setAll] = useState(false);
  const showAll = useCallback(() => setAll(true), []);
  if (chats.length === 0) {
    return empty ? (
      <li className="px-2 py-1 text-[12px] text-sidebar-foreground/45">
        {empty}
      </li>
    ) : null;
  }
  // 当前打开的对话就算排在后面也要露出来
  const activeIndex = chats.findIndex((c) => c.id === activeChat);
  const shown =
    all || chats.length <= SHOWN || activeIndex >= SHOWN
      ? chats
      : chats.slice(0, SHOWN);
  return (
    <>
      {shown.map((chat) => (
        <ChatItem
          chat={chat}
          isActive={chat.id === activeChat}
          key={chat.id}
          onDelete={onDelete}
          setOpenMobile={setOpenMobile}
        />
      ))}
      {shown.length < chats.length ? (
        <li>
          <button
            className="px-2 py-1 text-[12px] text-sidebar-foreground/50 hover:text-sidebar-foreground"
            onClick={showAll}
            type="button"
          >
            再显示 {chats.length - shown.length} 个
          </button>
        </li>
      ) : null}
    </>
  );
}
