"use client";

import { ChevronDownIcon, UserIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  STUDENT_COOKIE,
  STUDENTS,
  type StudentKey,
  studentByKey,
} from "@/lib/students";
import { FeedbackDialog } from "./feedback-dialog";

function readStudentKey() {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${STUDENT_COOKIE}=([^;]*)`)
  );
  return match?.[1];
}

function StudentItem({
  student,
  onPick,
}: {
  student: (typeof STUDENTS)[number];
  onPick: (key: StudentKey) => void;
}) {
  const handleSelect = useCallback(
    () => onPick(student.key),
    [onPick, student]
  );
  return (
    <DropdownMenuItem className="cursor-pointer" onSelect={handleSelect}>
      {student.name}
    </DropdownMenuItem>
  );
}

type Me = { name: string; role: "open" | "admin" | "trial" };

// 顶栏账号菜单。管理员（或没开登录时）能切换演示学生：换学生就换一套学习记录和对话列表，
// 回到新对话。试用账号只显示自己的名字（2026-10-24）。都能写反馈
export function StudentSwitcher() {
  const [current, setCurrent] = useState<string>("");
  const [me, setMe] = useState<Me | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    setCurrent(studentByKey(readStudentKey()).name);
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(setMe)
      .catch(() => undefined);
  }, []);

  const pick = useCallback((key: StudentKey) => {
    // biome-ignore lint/suspicious/noDocumentCookie: demo 只存一个学生 key，服务端读
    document.cookie = `${STUDENT_COOKIE}=${key}; path=/; max-age=31536000; samesite=lax`;
    window.location.href = "/";
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/login", { method: "DELETE" }).catch(() => undefined);
    window.location.href = "/login";
  }, []);

  const openFeedback = useCallback(() => setFeedbackOpen(true), []);

  const trial = me?.role === "trial";
  const label = trial && me ? me.name : current;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className="h-9 gap-1.5 px-2 font-normal text-[14px] text-muted-foreground"
            data-testid="student-switcher"
            variant="ghost"
          >
            <UserIcon className="size-3.5" />
            {label}
            <ChevronDownIcon className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {trial
            ? null
            : STUDENTS.map((s) => (
                <StudentItem key={s.key} onPick={pick} student={s} />
              ))}
          {trial ? null : <DropdownMenuSeparator />}
          <DropdownMenuItem
            className="cursor-pointer"
            data-testid="open-feedback"
            onSelect={openFeedback}
          >
            写反馈
          </DropdownMenuItem>
          {me?.role === "admin" || me?.role === "open" ? (
            <DropdownMenuItem asChild className="cursor-pointer">
              <a href="/admin">管理页</a>
            </DropdownMenuItem>
          ) : null}
          {me && me.role !== "open" ? (
            <DropdownMenuItem
              className="cursor-pointer"
              data-testid="logout"
              onSelect={logout}
            >
              退出
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <FeedbackDialog onOpenChange={setFeedbackOpen} open={feedbackOpen} />
    </>
  );
}
