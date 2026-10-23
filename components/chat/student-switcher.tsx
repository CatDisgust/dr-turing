"use client";

import { ChevronDownIcon, UserIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  STUDENT_COOKIE,
  STUDENTS,
  type StudentKey,
  studentByKey,
} from "@/lib/students";

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

// 顶栏“切换学生”：换学生就换一套学习记录和对话列表，回到新对话
export function StudentSwitcher() {
  const [current, setCurrent] = useState<string>(STUDENTS[0].name);

  useEffect(() => {
    setCurrent(studentByKey(readStudentKey()).name);
  }, []);

  const pick = useCallback((key: StudentKey) => {
    // biome-ignore lint/suspicious/noDocumentCookie: demo 只存一个学生 key，服务端读
    document.cookie = `${STUDENT_COOKIE}=${key}; path=/; max-age=31536000; samesite=lax`;
    window.location.href = "/";
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="h-9 gap-1.5 px-2 font-normal text-[14px] text-muted-foreground"
          data-testid="student-switcher"
          variant="ghost"
        >
          <UserIcon className="size-3.5" />
          {current}
          <ChevronDownIcon className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {STUDENTS.map((s) => (
          <StudentItem key={s.key} onPick={pick} student={s} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
