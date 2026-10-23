"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { COURSE_ID, LEARNER_REFRESH_EVENT } from "@/lib/constants";
import type { SessionReport } from "@/lib/types";

// 顶栏“结束本次学习”：跑会后复核，弹出这次的会话报告

const CONCEPT_OP = { add: "新增", invalidate: "作废", update: "更新" } as const;

const percent = (x: number | null) =>
  x === null ? "—" : `${Math.round(x * 100)}%`;

export function EndSession({
  chatId,
  disabled,
}: {
  chatId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<SessionReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const end = useCallback(async () => {
    setOpen(true);
    setReport(null);
    setError(null);
    try {
      const res = await fetch(`/api/session/${chatId}/end`, {
        body: JSON.stringify({ courseId: COURSE_ID }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? `复核失败（${res.status}）`);
      }
      setReport(body.report);
      window.dispatchEvent(new Event(LEARNER_REFRESH_EVENT));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [chatId]);

  const close = useCallback(() => setOpen(false), []);
  const startNew = useCallback(() => {
    setOpen(false);
    router.push("/");
  }, [router]);

  return (
    <>
      <Button
        className="md:ml-auto"
        data-testid="end-session"
        disabled={disabled}
        onClick={end}
        size="sm"
        variant="outline"
      >
        结束本次学习
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent data-testid="session-report">
          <DialogHeader>
            <DialogTitle>本次学习小结</DialogTitle>
            <DialogDescription>
              {report
                ? "复核完了，下面的数都已转正。"
                : "正在通读这次对话，复核会话里的批改结论…"}
            </DialogDescription>
          </DialogHeader>
          {error ? <p className="text-red-600 text-sm">{error}</p> : null}
          {report ? <ReportBody report={report} /> : null}
          <DialogFooter>
            <Button onClick={close} variant="ghost">
              关闭
            </Button>
            <Button disabled={!report} onClick={startNew}>
              开始新的学习
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReportBody({ report }: { report: SessionReport }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="font-medium text-base">
        {report.steps === 0
          ? "这次没有做题。"
          : `这次 ${report.steps} 步里有 ${report.ownSteps} 步是你自己做出来的。`}
      </p>
      <dl className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">看了答案才答</dt>
          <dd className="font-semibold text-base">
            {percent(report.revealRate)}
          </dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">自己说出推理</dt>
          <dd className="font-semibold text-base">
            {percent(report.selfProducedRate)}
          </dd>
        </div>
        <div className="rounded-md border p-2">
          <dt className="text-muted-foreground">导师泄漏答案</dt>
          <dd className="font-semibold text-base">{report.leaks} 次</dd>
        </div>
      </dl>
      {report.oGain.length > 0 ? (
        <section>
          <h4 className="mb-1 font-medium">自主掌握 O 的变化</h4>
          <ul className="flex flex-col gap-1 text-xs" data-testid="o-gain">
            {report.oGain.map((g) => (
              <li className="flex justify-between" key={g.kpId}>
                <span>{g.name}</span>
                <span>
                  {g.before.toFixed(2)} → {g.after.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {report.concepts && report.concepts.length > 0 ? (
        <section className="text-xs" data-testid="report-concepts">
          <h4 className="mb-1 font-medium text-sm">个人图谱</h4>
          <p className="text-muted-foreground">
            {report.concepts
              .map((c) => `${CONCEPT_OP[c.op]}「${c.name}」`)
              .join("，")}
          </p>
        </section>
      ) : null}
      <section className="text-xs">
        <h4 className="mb-1 font-medium text-sm">复核</h4>
        <p className="text-muted-foreground">
          确认 {report.confirmed} 条，推翻 {report.retracted.length} 条
          {report.revised?.length ? `，改判 ${report.revised.length} 条` : ""}。
        </p>
        {report.retracted.length > 0 ? (
          <ul
            className="mt-1 flex flex-col gap-1"
            data-testid="report-retracted"
          >
            {report.retracted.map((r) => (
              <li className="rounded-md border border-dashed p-2" key={r.quote}>
                「{r.name}」「{r.quote}」：{r.reason}
              </li>
            ))}
          </ul>
        ) : null}
        {report.revised && report.revised.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-1" data-testid="report-revised">
            {report.revised.map((r) => (
              <li className="rounded-md border p-2" key={r.quote}>
                「{r.name}」「{r.quote}」改判为{r.correct ? "对" : "错"}：
                {r.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
