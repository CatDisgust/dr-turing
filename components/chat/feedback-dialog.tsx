"use client";

import { type ChangeEvent, useCallback, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// 试用同学写一句反馈，管理页里看。顺手记下他在哪个页面写的
export function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const onChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value),
    []
  );

  const send = useCallback(async () => {
    setBusy(true);
    const res = await fetch("/api/feedback", {
      body: JSON.stringify({ page: window.location.pathname, text }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setText("");
      onOpenChange(false);
      toast.success("收到了，谢谢！");
    } else {
      toast.error("没发出去，再试一次");
    }
  }, [text, onOpenChange]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>写反馈</DialogTitle>
          <DialogDescription>
            哪里不好用、哪里讲得不对、想要什么，一句话就行。
          </DialogDescription>
        </DialogHeader>
        <textarea
          className="dt-input min-h-[120px] w-full p-3"
          data-testid="feedback-text"
          onChange={onChange}
          placeholder="比如：讲死锁那段例子太长了"
          value={text}
        />
        <div className="flex justify-end">
          <button
            className="dt-btn"
            data-testid="feedback-send"
            disabled={busy || !text.trim()}
            onClick={send}
            type="button"
          >
            {busy ? "发送中…" : "发送"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
