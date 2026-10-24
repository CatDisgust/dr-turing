"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import type { LearnStats } from "@/lib/learner/trial-stats";
import { CoursesSection } from "./courses-section";

type InviteRow = {
  code: string;
  name: string;
  disabled: boolean;
  dailyLimit: number;
  createdAt: string;
  lastSeenAt: string | null;
  chats: number;
  messagesToday: number;
  messagesTotal: number;
  daysActive: number;
  learn: LearnStats;
};

type FeedbackRow = {
  id: string;
  name: string | null;
  text: string;
  page: string | null;
  createdAt: string;
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("zh-CN", {
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        month: "numeric",
      })
    : "还没来过";

// 管理页（2026-10-24 试用账号）：给同学开邀请码、看用了多少、停用、加课、看反馈
export function AdminPanel() {
  const [invites, setInvites] = useState<InviteRow[] | null>(null);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/invites");
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "读不到");
      return;
    }
    setInvites(body.invites);
    setFeedback(body.feedback);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setError(null);
      const res = await fetch("/api/admin/invites", {
        body: JSON.stringify({ name }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "没开成");
        return;
      }
      setName("");
      load();
    },
    [name, load]
  );

  const patch = useCallback(
    async (
      code: string,
      change: { disabled?: boolean; dailyLimit?: number; rotate?: boolean }
    ) => {
      await fetch("/api/admin/invites", {
        body: JSON.stringify({ code, ...change }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      load();
    },
    [load]
  );

  const onName = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value),
    []
  );

  return (
    <>
      <header className="flex items-baseline justify-between">
        <h1 className="font-bold text-[24px]">管理</h1>
        <a className="dt-text-btn inline-flex items-center" href="/">
          回到学习页
        </a>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold text-[17px]">开一个试用账号</h2>
        <form className="flex gap-2" onSubmit={create}>
          <input
            className="dt-input h-10 flex-1 px-3"
            data-testid="invite-name"
            onChange={onName}
            placeholder="同学的名字，比如 小明 或 Ming"
            value={name}
          />
          <button
            className="dt-btn"
            data-testid="invite-create"
            disabled={!name.trim()}
            type="submit"
          >
            开邀请码
          </button>
        </form>
        {error ? (
          <p className="text-[14px] text-[var(--duo-red-ink)]">{error}</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold text-[17px]">
          试用账号 {invites ? `· ${invites.length} 个` : ""}
        </h2>
        {invites?.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">
            还没开过。上面输个名字就能开。
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[14px]" data-testid="invites">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-normal">名字</th>
                <th className="py-2 pr-3 font-normal">邀请码</th>
                <th className="py-2 pr-3 font-normal">最近来</th>
                <th className="py-2 pr-3 font-normal">对话</th>
                <th className="py-2 pr-3 font-normal">今天 / 上限</th>
                <th className="py-2 pr-3 font-normal">总消息</th>
                <th className="py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {invites?.map((row) => (
                <InviteLine key={row.code} onPatch={patch} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {invites && invites.length > 0 ? <TrialEffect invites={invites} /> : null}

      <CoursesSection />

      <section className="flex flex-col gap-3">
        <h2 className="font-bold text-[17px]">反馈</h2>
        {feedback.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">还没有人写反馈。</p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="feedback-list">
            {feedback.map((f) => (
              <li className="rounded-xl border-2 p-3" key={f.id}>
                <p className="whitespace-pre-wrap text-[15px]">{f.text}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {f.name ?? "?"} · {when(f.createdAt)}
                  {f.page ? ` · ${f.page}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2 text-[14px]">
        <h2 className="font-bold text-[17px]">演示工具</h2>
        <a className="dt-text-btn inline-flex w-fit items-center" href="/graph">
          重新生成某门课的图谱（自测页，会覆盖同 id 的课）
        </a>
        <a
          className="dt-text-btn inline-flex w-fit items-center"
          href="/compare"
        >
          A/B 对比和写入预置数据
        </a>
      </section>
    </>
  );
}

const rate = (k: number, n: number) =>
  n > 0 ? `${Math.round((k / n) * 100)}%` : "—";

// 试用效果（2026-10-24 评审建议）：来没来、留没留、学没学会。
// 最要紧的是最后一列：隔天复习自己做对，才说明真学会了，不是当时看懂
function TrialEffect({ invites }: { invites: InviteRow[] }) {
  const came = invites.filter((r) => r.messagesTotal > 0).length;
  const answered = invites.filter((r) => r.learn.answered > 0).length;
  const returned = invites.filter((r) => r.daysActive >= 2).length;
  const reviewed = invites.reduce((n, r) => n + r.learn.reviewed, 0);
  const passed = invites.reduce((n, r) => n + r.learn.reviewPassed, 0);
  return (
    <section className="flex flex-col gap-3" data-testid="trial-effect">
      <h2 className="font-bold text-[17px]">试用效果</h2>
      <p className="text-[15px]" data-testid="trial-summary">
        开了 {invites.length} 个码 · 来聊过 {came} 个 · 答过题 {answered} 个 ·
        隔天又来 {returned} 个 · 隔天复习自己做对 {passed}/{reviewed}（
        {rate(passed, reviewed)}）
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[14px]">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-normal">名字</th>
              <th className="py-2 pr-3 font-normal">来过几天</th>
              <th className="py-2 pr-3 font-normal">答题 对 / 总</th>
              <th className="py-2 pr-3 font-normal">真会</th>
              <th className="py-2 pr-3 font-normal">看懂</th>
              <th className="py-2 pr-3 font-normal">隔天复习 自己对 / 做了</th>
              <th className="py-2 font-normal">现在该复习</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((r) => (
              <tr
                className={`border-t-2 ${r.disabled ? "text-muted-foreground" : ""}`}
                data-testid={`effect-${r.code}`}
                key={r.code}
              >
                <td className="py-2 pr-3">{r.name}</td>
                <td className="py-2 pr-3">{r.daysActive}</td>
                <td className="py-2 pr-3">
                  {r.learn.correct} / {r.learn.answered}
                </td>
                <td className="py-2 pr-3">{r.learn.full}</td>
                <td className="py-2 pr-3">{r.learn.half}</td>
                <td className="py-2 pr-3">
                  {r.learn.reviewPassed} / {r.learn.reviewed}
                </td>
                <td className="py-2">{r.learn.due}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-muted-foreground">
        真会 = 隔一段时间自己做对过；看懂 =
        当时答对了，还没隔天验证。来过几天按悉尼日期算。
      </p>
    </section>
  );
}

function InviteLine({
  row,
  onPatch,
}: {
  row: InviteRow;
  onPatch: (
    code: string,
    change: { disabled?: boolean; dailyLimit?: number; rotate?: boolean }
  ) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    await navigator.clipboard
      .writeText(`${window.location.origin}/login?code=${row.code}`)
      .catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [row.code]);

  // 登录链接被转出去了：旧码立刻失效，换的新码要重新发给他
  const rotate = useCallback(
    () => onPatch(row.code, { rotate: true }),
    [onPatch, row.code]
  );

  const toggle = useCallback(
    () => onPatch(row.code, { disabled: !row.disabled }),
    [onPatch, row.code, row.disabled]
  );

  const setLimit = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const n = Number(event.target.value);
      if (n > 0 && n !== row.dailyLimit) {
        onPatch(row.code, { dailyLimit: n });
      }
    },
    [onPatch, row.code, row.dailyLimit]
  );

  return (
    <tr
      className={`border-t-2 ${row.disabled ? "text-muted-foreground" : ""}`}
      data-testid={`invite-${row.code}`}
    >
      <td className="py-2 pr-3">{row.name}</td>
      <td className="py-2 pr-3 font-mono">{row.code}</td>
      <td className="py-2 pr-3">{when(row.lastSeenAt)}</td>
      <td className="py-2 pr-3">{row.chats}</td>
      <td className="py-2 pr-3">
        {row.messagesToday} /{" "}
        <input
          aria-label="每天最多发几条"
          className="dt-input h-8 w-16 px-2 text-[14px]"
          defaultValue={row.dailyLimit}
          min={1}
          onBlur={setLimit}
          type="number"
        />
      </td>
      <td className="py-2 pr-3">{row.messagesTotal}</td>
      <td className="whitespace-nowrap py-2">
        <button className="dt-text-btn" onClick={copy} type="button">
          {copied ? "已复制" : "复制登录链接"}
        </button>
        <button
          className="dt-text-btn"
          onClick={rotate}
          title="旧码立刻作废，学习记录不动；新登录链接要重新发给他"
          type="button"
        >
          换码
        </button>
        <button className="dt-text-btn" onClick={toggle} type="button">
          {row.disabled ? "恢复" : "停用"}
        </button>
      </td>
    </tr>
  );
}
