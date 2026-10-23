"use client";

import { PanelLeftIcon } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { EndSession } from "./end-session";
import { LessonProgress } from "./lesson-progress";
import { StudentSwitcher } from "./student-switcher";
import type { VisibilityType } from "./visibility-selector";

// 顶栏（视觉规范 LessonProgress）：字标、课名、本课进度、切换学生、“结束本次学习”。
// 侧栏收起时也要在，结束按钮不能跟着消失
function PureChatHeader({
  chatId,
  isReadonly,
  canEnd,
  targetId,
}: {
  chatId: string;
  targetId?: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
  canEnd: boolean;
}) {
  const { toggleSidebar } = useSidebar();

  return (
    <header className="sticky top-0 flex h-14 shrink-0 items-center gap-4 border-b-2 bg-background px-4 md:px-7">
      <Button
        className="-mr-3 md:hidden"
        onClick={toggleSidebar}
        size="icon-sm"
        variant="ghost"
      >
        <PanelLeftIcon className="size-4" />
      </Button>

      <span className="font-bold text-[18px] tracking-[-0.01em]">
        Dr.Turing
      </span>

      <LessonProgress key={chatId} targetId={targetId} />

      <div className="ml-auto flex items-center gap-1">
        <StudentSwitcher />
        {isReadonly ? null : <EndSession chatId={chatId} disabled={!canEnd} />}
      </div>
    </header>
  );
}

export const ChatHeader = memo(
  PureChatHeader,
  (prevProps, nextProps) =>
    prevProps.chatId === nextProps.chatId &&
    prevProps.selectedVisibilityType === nextProps.selectedVisibilityType &&
    prevProps.isReadonly === nextProps.isReadonly &&
    prevProps.canEnd === nextProps.canEnd &&
    prevProps.targetId === nextProps.targetId
);
