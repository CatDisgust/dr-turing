"use client";

import { type MouseEvent, useCallback, useEffect, useState } from "react";

// 划词菜单：课件和导师回复里选中一段，弹出“问这句 / 引用回复”。
// 可选的区域用 data-quote-source 标出来源（“课件第 3 页”“导师刚才说的”），选区两端必须在同一块里

const MAX_QUOTE = 600;

type Picked = { text: string; source: string; x: number; y: number };

function clip(quote: string) {
  return quote.length > MAX_QUOTE ? `${quote.slice(0, MAX_QUOTE)}…` : quote;
}

export function quoteText(quote: string, source: string) {
  return `「${clip(quote)}」（${source}）`;
}

export function askText(quote: string, source: string) {
  return `${quoteText(quote, source)}这句是什么意思？`;
}

function sourceOf(node: Node | null) {
  const el = node instanceof Element ? node : node?.parentElement;
  return el?.closest<HTMLElement>("[data-quote-source]") ?? null;
}

function readSelection(): Picked | null {
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? "";
  if (!selection || text === "" || selection.rangeCount === 0) {
    return null;
  }
  const from = sourceOf(selection.anchorNode);
  if (!from || from !== sourceOf(selection.focusNode)) {
    return null;
  }
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  return {
    source: from.dataset.quoteSource ?? "",
    text,
    x: Math.min(Math.max(8, rect.left), window.innerWidth - 180),
    y: Math.min(rect.bottom + 6, window.innerHeight - 40),
  };
}

export function SelectionMenu({
  onAsk,
  onQuote,
  disabled,
}: {
  onAsk: (text: string) => void;
  onQuote: (text: string) => void;
  disabled?: boolean;
}) {
  const [picked, setPicked] = useState<Picked | null>(null);

  useEffect(() => {
    // 松开鼠标时读选区；选区被清空（点别处、滚动后重选）就收起
    const onUp = () => setTimeout(() => setPicked(readSelection()), 0);
    const onChange = () => {
      if (window.getSelection()?.isCollapsed) {
        setPicked(null);
      }
    };
    const onScroll = () => setPicked(null);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  const done = useCallback(() => {
    setPicked(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const ask = useCallback(() => {
    if (picked) {
      onAsk(askText(picked.text, picked.source));
      done();
    }
  }, [done, onAsk, picked]);
  const quote = useCallback(() => {
    if (picked) {
      onQuote(quoteText(picked.text, picked.source));
      done();
    }
  }, [done, onQuote, picked]);

  if (!picked || disabled) {
    return null;
  }
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 只为按下时保住选区、松开时不让 document 重读
    <div
      className="fixed z-50 flex gap-1 rounded-md border bg-popover p-1 text-xs shadow-md"
      data-testid="selection-menu"
      onMouseDown={keepSelection}
      onMouseUp={stop}
      role="toolbar"
      style={{ left: picked.x, top: picked.y }}
    >
      <button
        className="rounded bg-primary px-2 py-1 text-primary-foreground"
        data-testid="ask-selection"
        onClick={ask}
        type="button"
      >
        问这句
      </button>
      <button
        className="rounded px-2 py-1 hover:bg-muted"
        data-testid="quote-selection"
        onClick={quote}
        type="button"
      >
        引用回复
      </button>
    </div>
  );
}

// 按下菜单时别让浏览器清掉选区；松开不能冒泡到 document，否则菜单被重读成空的
function keepSelection(event: MouseEvent) {
  event.preventDefault();
}
function stop(event: MouseEvent) {
  event.stopPropagation();
}
