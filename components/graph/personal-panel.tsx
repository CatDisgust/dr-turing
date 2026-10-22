"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FULL_O, HALF_M } from "@/lib/learner/config";
import type { Ability, LearnerState, PersonalConcept } from "@/lib/types";

// 个人图谱：这门课点亮了多少、三项底层能力、课外概念（未锚定，可以删）。
// 每一项都能看到是从哪几条证据来的

type Personal = { abilities: Ability[]; concepts: PersonalConcept[] };

const percent = (x: number) => `${Math.round(x * 100)}%`;

export function PersonalPanel({
  state,
  total,
}: {
  state: LearnerState | null;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Personal | null>(null);

  const load = useCallback(() => {
    fetch("/api/personal")
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
  const remove = useCallback(
    (id: string) => {
      fetch(`/api/personal/concepts/${id}`, { method: "DELETE" }).then(load);
    },
    [load]
  );

  const nodes = Object.values(state?.nodes ?? {});
  const full = nodes.filter((n) => n.O >= FULL_O).length;
  const half = nodes.filter((n) => n.M >= HALF_M && n.O < FULL_O).length;

  return (
    <>
      <Button
        className="absolute top-3 right-3 z-[5]"
        data-testid="open-personal"
        onClick={show}
        size="sm"
        variant="outline"
      >
        我的个人图谱
      </Button>
      <Sheet onOpenChange={setOpen} open={open}>
        <SheetContent
          className="flex flex-col gap-4 overflow-y-auto"
          data-testid="personal-panel"
        >
          <SheetHeader>
            <SheetTitle>我的个人图谱</SheetTitle>
            <SheetDescription>
              每次结束学习后自动更新。数都是从你的答题记录算出来的，点开能看到证据。
            </SheetDescription>
          </SheetHeader>

          <section className="px-4 text-sm">
            <h4 className="mb-1 font-medium">这门课</h4>
            <p className="text-muted-foreground text-xs">
              {total} 个知识点里，全亮 {full} 个，半亮 {half} 个。
            </p>
          </section>

          <section className="px-4 text-sm" data-testid="abilities">
            <h4 className="mb-2 font-medium">底层能力</h4>
            <ul className="flex flex-col gap-3">
              {(data?.abilities ?? []).map((a) => (
                <AbilityRow ability={a} key={a.key} />
              ))}
            </ul>
          </section>

          <section className="px-4 pb-4 text-sm" data-testid="concepts">
            <h4 className="mb-1 font-medium">课外概念</h4>
            <p className="mb-2 text-muted-foreground text-xs">
              对话里提到、但不在课程图谱里的概念，标“未锚定”。记错了可以删掉。
            </p>
            {data && data.concepts.length === 0 ? (
              <p className="text-muted-foreground text-xs">还没有。</p>
            ) : null}
            <ul className="flex flex-col gap-2">
              {(data?.concepts ?? []).map((c) => (
                <ConceptRow concept={c} key={c.id} onRemove={remove} />
              ))}
            </ul>
          </section>
        </SheetContent>
      </Sheet>
    </>
  );
}

function AbilityRow({ ability: a }: { ability: Ability }) {
  return (
    <li>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-sm">{a.label}</span>
        <span className="text-muted-foreground">
          {a.certain
            ? `${percent(a.value)}（${percent(a.low)}–${percent(a.high)}）`
            : "还不确定"}
          {` · ${a.k}/${a.n} 条`}
        </span>
      </div>
      <div className="relative mt-1 h-1.5 rounded bg-muted">
        <div
          className="absolute h-full rounded bg-foreground/20"
          style={{
            left: percent(a.low),
            width: percent(a.high - a.low),
          }}
        />
        <div
          className={
            a.certain
              ? "absolute h-full w-1 rounded bg-foreground"
              : "absolute h-full w-1 rounded bg-muted-foreground"
          }
          style={{ left: percent(a.value) }}
        />
      </div>
      {a.evidence.length > 0 ? (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            证据
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {a.evidence.map((e) => (
              <li key={`${e.at}-${e.quote}`}>
                <span
                  className={e.success ? "text-emerald-600" : "text-red-600"}
                >
                  {e.success ? "✓" : "✗"}
                </span>{" "}
                「{e.quote}」
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

function ConceptRow({
  concept: c,
  onRemove,
}: {
  concept: PersonalConcept;
  onRemove: (id: string) => void;
}) {
  const remove = useCallback(() => onRemove(c.id), [c.id, onRemove]);
  return (
    <li className="rounded-md border border-dashed p-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">{c.name}</span>
        <span className="rounded bg-muted px-1">未锚定</span>
        <span className="rounded bg-muted px-1">
          {c.level === "claimed" ? "自称会" : "接触过"}
        </span>
        <button
          className="ml-auto text-muted-foreground hover:text-red-600"
          onClick={remove}
          type="button"
        >
          删掉
        </button>
      </div>
      <p className="mt-1">{c.definition}</p>
      <ul className="mt-1 text-muted-foreground">
        {c.evidence.map((e) => (
          <li key={`${e.at}-${e.quote}`}>「{e.quote}」</li>
        ))}
      </ul>
    </li>
  );
}
