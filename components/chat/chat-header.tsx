"use client";

import { PanelLeftIcon } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { EndSession } from "./end-session";
import { StudentSwitcher } from "./student-switcher";
import { VisibilitySelector, type VisibilityType } from "./visibility-selector";

// 顶栏：侧栏开关、切换学生、可见性、“结束本次学习”。侧栏收起时也要在，结束按钮不能跟着消失
function PureChatHeader({
  chatId,
  selectedVisibilityType,
  isReadonly,
  canEnd,
}: {
  chatId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
  canEnd: boolean;
}) {
  const { toggleSidebar } = useSidebar();

  return (
    <header className="sticky top-0 flex h-14 items-center gap-2 bg-sidebar px-3">
      <Button
        className="md:hidden"
        onClick={toggleSidebar}
        size="icon-sm"
        variant="ghost"
      >
        <PanelLeftIcon className="size-4" />
      </Button>

      <StudentSwitcher />

      {!isReadonly && (
        <VisibilitySelector
          chatId={chatId}
          selectedVisibilityType={selectedVisibilityType}
        />
      )}

      {isReadonly ? null : <EndSession chatId={chatId} disabled={!canEnd} />}
    </header>
  );
}

export const ChatHeader = memo(
  PureChatHeader,
  (prevProps, nextProps) =>
    prevProps.chatId === nextProps.chatId &&
    prevProps.selectedVisibilityType === nextProps.selectedVisibilityType &&
    prevProps.isReadonly === nextProps.isReadonly &&
    prevProps.canEnd === nextProps.canEnd
);
