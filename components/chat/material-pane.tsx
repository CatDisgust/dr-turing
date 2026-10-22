"use client";

import {
  type ChangeEvent,
  type MouseEvent,
  useCallback,
  useRef,
  useState,
} from "react";

// 左边的课件：学生打开自己电脑上的 PDF，只在浏览器里读出文字，不上传（课件有版权）。
// 划一句，点“问这句”，带着原文和页码发给导师

const MAX_QUOTE = 600;

type Page = { page: number; text: string };
type Picked = { text: string; page: number; top: number; left: number };

async function readPdf(file: File): Promise<Page[]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  const numbers = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  return Promise.all(
    numbers.map(async (page) => {
      const content = await (await pdf.getPage(page)).getTextContent();
      let text = "";
      for (const item of content.items) {
        if ("str" in item) {
          text += item.str + (item.hasEOL ? "\n" : "");
        }
      }
      return { page, text: text.trim() };
    })
  );
}

export function askText(quote: string, page: number) {
  const clipped =
    quote.length > MAX_QUOTE ? `${quote.slice(0, MAX_QUOTE)}…` : quote;
  return `「${clipped}」（课件第 ${page} 页）这句是什么意思？`;
}

export function MaterialPane({ onAsk }: { onAsk: (text: string) => void }) {
  const [fileName, setFileName] = useState("");
  const [pages, setPages] = useState<Page[]>([]);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const onFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setError("");
    setPicked(null);
    setFileName(file.name);
    try {
      setPages(await readPdf(file));
    } catch (e) {
      setPages([]);
      setError(`读不出这份 PDF：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const onMouseUp = useCallback((_: MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    const box = boxRef.current;
    if (!(selection && box) || text === "" || selection.rangeCount === 0) {
      setPicked(null);
      return;
    }
    const anchor = selection.anchorNode;
    const pageEl = (
      anchor instanceof Element ? anchor : anchor?.parentElement
    )?.closest<HTMLElement>("[data-page]");
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    setPicked({
      left: Math.max(0, rect.left - boxRect.left),
      page: Number(pageEl?.dataset.page ?? 1),
      text,
      top: rect.bottom - boxRect.top + box.scrollTop + 4,
    });
  }, []);

  const ask = useCallback(() => {
    if (!picked) {
      return;
    }
    onAsk(askText(picked.text, picked.page));
    setPicked(null);
    window.getSelection()?.removeAllRanges();
  }, [onAsk, picked]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        <span className="font-medium">课件</span>
        <span className="truncate text-muted-foreground text-xs">
          {fileName || "打开本地 PDF，只在浏览器里读，不上传"}
        </span>
        <label className="ml-auto cursor-pointer rounded-md border px-2 py-1 text-xs hover:bg-muted">
          打开
          <input
            accept="application/pdf"
            className="hidden"
            data-testid="material-file"
            onChange={onFile}
            type="file"
          />
        </label>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 划词只能在文字区域上监听 mouseup */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: 同上 */}
      <div
        className="relative min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm leading-relaxed"
        data-testid="material-text"
        onMouseUp={onMouseUp}
        ref={boxRef}
      >
        {error ? <p className="text-destructive">{error}</p> : null}
        {pages.length === 0 && !error ? (
          <p className="text-muted-foreground">
            打开一份课件后，划一句话，点“问这句”就能问导师。
          </p>
        ) : null}
        {pages.map(({ page, text }) => (
          <section className="mb-6" data-page={page} key={page}>
            <div className="mb-1 text-muted-foreground text-xs">
              第 {page} 页
            </div>
            <p className="whitespace-pre-wrap">{text || "（这页没有文字）"}</p>
          </section>
        ))}
        {picked ? (
          <button
            className="absolute z-10 rounded-md bg-primary px-2 py-1 text-primary-foreground text-xs shadow"
            data-testid="ask-selection"
            onClick={ask}
            onMouseUp={stop}
            style={{ left: picked.left, top: picked.top }}
            type="button"
          >
            问这句
          </button>
        ) : null}
      </div>
    </div>
  );
}

// 点按钮本身的 mouseup 不能冒泡到文字区，否则选区被当成空的、按钮先消失
function stop(event: MouseEvent) {
  event.stopPropagation();
}
