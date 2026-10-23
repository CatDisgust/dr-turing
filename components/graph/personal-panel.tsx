"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GraphPanel } from "@/components/graph/graph-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CLUSTER,
  collapseCourses,
  type MergeTarget,
  mergeCandidates,
  type Star,
  type StarMap,
} from "@/lib/learner/star-map";
import type { Ability } from "@/lib/types";

// 我的星图（用户 2026-10-23 看过样稿说“继续”）：跨所有课，只画小明碰过的概念。
// 左边星空，右边点开一颗星看凭什么；课外概念能纠错：和另一个是同一个（能拆开）、记错了

type MapData = StarMap & { abilities: Ability[] };

const percent = (x: number) => `${Math.round(x * 100)}%`;

const STATUS: Record<Star["light"], string> = {
  dashed: "这次问到了，还没答过题",
  full: "真会了：隔天自己答对过",
  gray: "碰过，还没看懂",
  half: "看懂了，还没隔天自己答对",
};

const HOW: Record<Star["evidence"][number]["how"], string> = {
  answer: "答题",
  chat: "聊到",
  mention: "提到",
};

const day = (at: string) =>
  new Date(at).toLocaleDateString("zh-CN", { day: "numeric", month: "long" });

export function PersonalPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MapData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // 展开了哪几门课（课内每门课先收成一团）
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const shown = useMemo(
    () => (data ? collapseCourses(data, expanded) : null),
    [data, expanded]
  );

  const load = useCallback(() => {
    fetch("/api/personal/map")
      .then((res) => res.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open, load]);

  const show = useCallback(() => setOpen(true), []);
  // 点星云就展开那门课；选中收起的课里的星（比如从“常一起出现”点过去）也先展开
  const select = useCallback(
    (id: string | null) => {
      setMerging(false);
      if (id?.startsWith(CLUSTER)) {
        const block = id.slice(CLUSTER.length);
        setExpanded((e) => new Set([...e, block]));
        setSelectedId(null);
        return;
      }
      const block = data?.graph.points.find((p) => p.id === id)?.lessonId;
      if (block) {
        setExpanded((e) => new Set([...e, block]));
      }
      setSelectedId(id);
    },
    [data]
  );
  const fold = useCallback(() => {
    const block = data?.graph.points.find((p) => p.id === selectedId)?.lessonId;
    setExpanded((e) => new Set([...e].filter((b) => b !== block)));
    setSelectedId(null);
  }, [data, selectedId]);
  const unlink = useCallback(
    (linkId: string, name: string) => {
      fetch(`/api/personal/links/${linkId}`, { method: "DELETE" }).then(() => {
        setNotice(`记下了：和「${name}」的这条关系是连错的，不再显示`);
        load();
      });
    },
    [load]
  );
  const toggleMerge = useCallback(() => setMerging((m) => !m), []);

  const star = selectedId ? data?.stars[selectedId] : undefined;

  const mergeInto = useCallback(
    (into: MergeTarget) => {
      if (!star) {
        return;
      }
      fetch(`/api/personal/concepts/${star.id}/merge`, {
        body: JSON.stringify({ into: into.id }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }).then(() => {
        setNotice(`已把「${star.name}」并进「${into.name}」`);
        setSelectedId(into.id);
        setMerging(false);
        load();
      });
    },
    [star, load]
  );
  const split = useCallback(
    (mergeId: string, name: string) => {
      fetch(`/api/personal/merges/${mergeId}`, { method: "DELETE" }).then(
        () => {
          setNotice(`已拆开，「${name}」又单独算了`);
          load();
        }
      );
    },
    [load]
  );
  const markWrong = useCallback(() => {
    if (!star) {
      return;
    }
    fetch(`/api/personal/concepts/${star.id}`, { method: "DELETE" }).then(
      () => {
        setNotice(`记下了：「${star.name}」是记错的，不再显示`);
        setSelectedId(null);
        load();
      }
    );
  }, [star, load]);

  return (
    <>
      <Button
        className="absolute top-3 right-3 z-[5]"
        data-testid="open-personal"
        onClick={show}
        size="sm"
        variant="outline"
      >
        我的星图
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent
          className="flex h-[92vh] w-[96vw] max-w-none gap-0 overflow-hidden bg-[#050506] p-0 text-stone-100 sm:max-w-none"
          data-testid="personal-panel"
        >
          <div className="relative min-w-0 flex-1">
            <div className="pointer-events-none absolute top-5 left-6 z-[5]">
              <DialogTitle className="font-semibold text-2xl tracking-wide">
                我的星图
              </DialogTitle>
              <DialogDescription className="mt-2 text-stone-400 text-xs">
                你学过、聊过的所有概念，不分哪门课。亮度是答题答出来的，这里只能看。
              </DialogDescription>
            </div>
            <ul className="pointer-events-none absolute bottom-4 left-20 z-[5] flex flex-wrap gap-x-4 gap-y-1 text-stone-400 text-xs">
              <li>全亮：真会了</li>
              <li>半亮：看懂了 / 课外在两次以上对话里聊过</li>
              <li>课内每门课先收成一团，点开看</li>
              <li>暗：只出现过一次</li>
              <li className="text-sky-300/80">
                选中一颗星：蓝色实线是意思上有关系，虚线是常一起出现
              </li>
            </ul>
            {data && data.graph.points.length > 0 ? (
              <GraphPanel
                graph={shown?.graph ?? data.graph}
                lights={shown?.lights}
                onSelect={select}
                plainTitles
                progress={data.progress}
                related={shown?.related}
                selectedId={selectedId}
              />
            ) : (
              <p className="p-6 pt-28 text-sm text-stone-400">
                {data ? "还没有。学一会儿、聊一会儿，这里就会出现星星。" : ""}
              </p>
            )}
          </div>
          <aside
            className="flex w-[380px] shrink-0 flex-col gap-5 overflow-y-auto border-white/10 border-l bg-[#0b0b0e] p-6 pt-14"
            data-testid="star-detail"
          >
            {notice ? (
              <p
                className="rounded-lg bg-white/5 px-3 py-2 text-stone-200 text-xs"
                data-testid="star-notice"
              >
                {notice}
              </p>
            ) : null}
            {star ? (
              <StarDetail
                candidates={
                  merging && data ? mergeCandidates(data, star.id) : []
                }
                merging={merging}
                onFold={fold}
                onMarkWrong={markWrong}
                onMerge={mergeInto}
                onSelect={select}
                onSplit={split}
                onToggleMerge={toggleMerge}
                onUnlink={unlink}
                star={star}
                stars={data?.stars ?? {}}
              />
            ) : (
              <Overview abilities={data?.abilities ?? []} />
            )}
          </aside>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Overview({ abilities }: { abilities: Ability[] }) {
  return (
    <>
      <p className="text-sm text-stone-400 leading-relaxed">
        点一颗星，看系统凭什么认为你见过它：哪次对话、你原话怎么说的。
      </p>
      <section className="flex flex-col gap-3" data-testid="abilities">
        <h3 className="font-medium text-sm text-stone-300">底层能力</h3>
        {abilities.map((a) => (
          <div key={a.key}>
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-sm">{a.label}</span>
              <span className="text-stone-400">
                {a.certain
                  ? `${percent(a.value)}（${percent(a.low)}–${percent(a.high)}）`
                  : "还不确定"}
                {` · ${a.k}/${a.n} 条`}
              </span>
            </div>
            <div className="relative mt-1 h-1.5 rounded bg-white/10">
              <div
                className="absolute h-full rounded bg-white/20"
                style={{
                  left: percent(a.low),
                  width: percent(a.high - a.low),
                }}
              />
              <div
                className={
                  a.certain
                    ? "absolute h-full w-1 rounded bg-white"
                    : "absolute h-full w-1 rounded bg-stone-500"
                }
                style={{ left: percent(a.value) }}
              />
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

function StarDetail({
  star,
  merging,
  candidates,
  onToggleMerge,
  onMerge,
  onSplit,
  onMarkWrong,
  onSelect,
  onFold,
  onUnlink,
  stars,
}: {
  onFold: () => void;
  onUnlink: (linkId: string, name: string) => void;
  star: Star;
  stars: Record<string, Star>;
  merging: boolean;
  candidates: MergeTarget[];
  onToggleMerge: () => void;
  onMerge: (into: MergeTarget) => void;
  onSplit: (mergeId: string, name: string) => void;
  onMarkWrong: () => void;
  onSelect: (id: string | null) => void;
}) {
  const outside = star.kind === "outside";
  const back = useCallback(() => onSelect(null), [onSelect]);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span
          className={
            outside ? "text-sky-300 text-xs" : "text-amber-200 text-xs"
          }
        >
          {star.where}
        </span>
        <h2 className="font-semibold text-2xl" data-testid="star-name">
          {star.name}
        </h2>
        {star.aliases.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-stone-400">也叫</span>
            {star.aliases.map((a) => (
              <span className="rounded-full bg-white/10 px-2 py-0.5" key={a}>
                {a}
              </span>
            ))}
          </div>
        ) : null}
        <span className="text-sm text-stone-300">
          {outside
            ? star.light === "gray"
              ? "只在一次对话里出现过，先暗着；在别的对话里再出现一次就亮"
              : "在好几次对话里聊过（课外概念没有检查题，不打分）"
            : STATUS[star.light]}
        </span>
      </div>

      <p className="text-sm text-stone-200 leading-relaxed">
        {star.definition}
      </p>

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-stone-400 text-xs">凭什么</h3>
        {star.evidence.map((e) => (
          <div
            className="flex flex-col gap-1 rounded-lg bg-white/5 px-3 py-2"
            key={`${e.at}-${e.quote}`}
          >
            <span className="text-sky-300 text-xs">
              {day(e.at)} · {HOW[e.how]}
              {e.correct === undefined ? "" : e.correct ? " · 答对" : " · 答错"}
              {e.course ? ` · ${e.course}` : ""}
            </span>
            {e.chat ? (
              <a
                className="text-stone-400 text-xs underline-offset-2 hover:text-stone-200 hover:underline"
                data-testid="backlink"
                href={`/chat/${e.sessionId}`}
              >
                对话「{e.chat}」
              </a>
            ) : null}
            <span className="text-sm leading-relaxed">你：「{e.quote}」</span>
          </div>
        ))}
      </section>

      {star.links.length > 0 ? (
        <section className="flex flex-col gap-2" data-testid="links">
          <h3 className="font-medium text-stone-400 text-xs">有关系</h3>
          {star.links.map((l) => (
            <LinkRow
              key={l.linkId}
              link={l}
              onSelect={onSelect}
              onUnlink={onUnlink}
            />
          ))}
        </section>
      ) : null}

      {star.related.length > 0 ? (
        <section className="flex flex-col gap-2" data-testid="related">
          <h3 className="font-medium text-stone-400 text-xs">常一起出现</h3>
          <div className="flex flex-wrap gap-1.5">
            {star.related.flatMap((id) =>
              stars[id] ? (
                <RelatedChip key={id} onSelect={onSelect} star={stars[id]} />
              ) : (
                []
              )
            )}
          </div>
        </section>
      ) : null}

      {star.merged.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium text-stone-400 text-xs">
            你合并进来的课外概念
          </h3>
          {star.merged.map((m) => (
            <div className="flex items-center gap-2 text-sm" key={m.mergeId}>
              <span>「{m.name}」</span>
              <SplitButton item={m} onSplit={onSplit} />
            </div>
          ))}
        </section>
      ) : null}

      {outside ? (
        <div className="flex gap-2 border-white/10 border-t pt-4">
          <Button
            className="flex-1"
            data-testid="merge-open"
            onClick={onToggleMerge}
            variant="outline"
          >
            和另一个是同一个
          </Button>
          <Button
            className="flex-1 text-red-300"
            data-testid="mark-wrong"
            onClick={onMarkWrong}
            variant="outline"
          >
            记错了
          </Button>
        </div>
      ) : null}

      {merging ? (
        <div className="flex flex-col gap-2 rounded-lg border border-white/10 p-3">
          <span className="text-stone-400 text-xs">
            「{star.name}
            」和哪个是同一个？名字像的排在前面。并进课内知识点后，它就算那个知识点的出处，不改亮度
          </span>
          {candidates.length === 0 ? (
            <span className="text-stone-500 text-xs">没找到可以合并的。</span>
          ) : null}
          {candidates.map((c) => (
            <CandidateButton key={c.id} onMerge={onMerge} target={c} />
          ))}
        </div>
      ) : null}

      {outside ? null : (
        <div className="flex items-center gap-2 text-stone-500 text-xs">
          课内知识点的亮度只看你答题，这里改不了。
          <button
            className="ml-auto shrink-0 hover:text-stone-300"
            data-testid="fold"
            onClick={onFold}
            type="button"
          >
            收起这门课
          </button>
        </div>
      )}
      <button
        className="self-start text-stone-500 text-xs hover:text-stone-300"
        onClick={back}
        type="button"
      >
        ← 返回总览
      </button>
    </div>
  );
}

function SplitButton({
  item,
  onSplit,
}: {
  item: Star["merged"][number];
  onSplit: (mergeId: string, name: string) => void;
}) {
  const split = useCallback(
    () => onSplit(item.mergeId, item.name),
    [item, onSplit]
  );
  return (
    <Button
      className="ml-auto"
      data-testid="split"
      onClick={split}
      size="sm"
      variant="outline"
    >
      拆开
    </Button>
  );
}

function CandidateButton({
  target: c,
  onMerge,
}: {
  target: MergeTarget;
  onMerge: (into: MergeTarget) => void;
}) {
  const merge = useCallback(() => onMerge(c), [c, onMerge]);
  return (
    <Button
      className="h-auto justify-start whitespace-normal py-2 text-left"
      data-testid="merge-candidate"
      onClick={merge}
      variant="outline"
    >
      {c.name}
      <span className="text-stone-400">
        {c.kind === "course" ? `　${c.where}` : "　课外"}
        {c.aliases.length > 0 ? `，也叫 ${c.aliases.join("、")}` : ""}
      </span>
    </Button>
  );
}

function RelatedChip({
  star,
  onSelect,
}: {
  star: Star;
  onSelect: (id: string | null) => void;
}) {
  const pick = useCallback(() => onSelect(star.id), [star.id, onSelect]);
  return (
    <button
      className="min-h-8 rounded-full border border-white/15 px-3 text-sm hover:bg-white/10"
      onClick={pick}
      type="button"
    >
      {star.name}
    </button>
  );
}

function LinkRow({
  link,
  onSelect,
  onUnlink,
}: {
  link: Star["links"][number];
  onSelect: (id: string | null) => void;
  onUnlink: (linkId: string, name: string) => void;
}) {
  const pick = useCallback(() => onSelect(link.to), [link.to, onSelect]);
  const remove = useCallback(
    () => onUnlink(link.linkId, link.name),
    [link, onUnlink]
  );
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm">
      <button
        className="text-left hover:underline"
        onClick={pick}
        type="button"
      >
        {link.label}
      </button>
      <button
        className="ml-auto shrink-0 text-red-300/80 text-xs hover:text-red-300"
        data-testid="unlink"
        onClick={remove}
        type="button"
      >
        连错了
      </button>
    </div>
  );
}
