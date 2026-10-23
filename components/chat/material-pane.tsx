"use client";

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PDFDocumentProxy } from "unpdf/pdfjs";

// 课件：学生打开自己电脑上的 PDF，在浏览器里按原样画出来，不上传（课件有版权）。
// 每页是一张画布加一层透明文字层，所以能照常划词；划词菜单见 selection-menu.tsx

export function MaterialPane() {
  const [fileName, setFileName] = useState("");
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [ratio, setRatio] = useState(0.75);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // 侧拉框宽度一变，页面按新宽度重画
  useEffect(() => {
    const box = boxRef.current;
    if (!box) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const onFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setError("");
    setFileName(file.name);
    try {
      const { getDocumentProxy } = await import("unpdf");
      const doc = await getDocumentProxy(
        new Uint8Array(await file.arrayBuffer())
      );
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      setRatio(first.height / first.width);
      setPdf(doc);
    } catch (e) {
      setPdf(null);
      setError(`读不出这份 PDF：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        <span className="truncate text-muted-foreground text-xs">
          {fileName || "打开本地 PDF，只在浏览器里显示，不上传"}
        </span>
        <label className="ml-auto shrink-0 cursor-pointer rounded-md border px-2 py-1 text-xs hover:bg-muted">
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
      <div
        className="min-h-0 flex-1 overflow-y-auto bg-muted/40 p-3"
        data-testid="material-pages"
      >
        <div ref={boxRef}>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          {pdf || error ? null : (
            <p className="text-muted-foreground text-sm">
              打开一份课件后，选中一句话，点“问这句”问导师，或“引用回复”带进输入框。
            </p>
          )}
          {pdf && width > 0
            ? Array.from({ length: pdf.numPages }, (_, i) => i + 1).map((n) => (
                <PdfPage
                  key={n}
                  pageNumber={n}
                  pdf={pdf}
                  ratio={ratio}
                  width={width}
                />
              ))
            : null}
        </div>
      </div>
    </div>
  );
}

// 一页：滚到附近才画，省得几十页一起画
function PdfPage({
  pdf,
  pageNumber,
  width,
  ratio,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  ratio: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [height, setHeight] = useState(Math.round(width * ratio));
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textBox = textRef.current;
    if (!(near && canvas && textBox)) {
      return;
    }
    let cancelled = false;
    let cancel = () => {
      cancelled = true;
    };
    (async () => {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({
        scale: width / page.getViewport({ scale: 1 }).width,
      });
      if (cancelled) {
        return;
      }
      setScale(viewport.scale);
      setHeight(Math.round(viewport.height));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }
      const task = page.render({
        canvas,
        canvasContext: context,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        viewport,
      });
      const { TextLayer } = await (await import("unpdf")).getResolvedPDFJS();
      textBox.replaceChildren();
      const layer = new TextLayer({
        container: textBox,
        textContentSource: page.streamTextContent(),
        viewport,
      });
      cancel = () => {
        cancelled = true;
        task.cancel();
        layer.cancel();
      };
      await Promise.all([task.promise, layer.render()]).catch(() => {
        /* 宽度变了被取消，下一轮重画 */
      });
    })();
    return () => cancel();
  }, [near, pdf, pageNumber, width]);

  return (
    <div
      className="relative mb-3 overflow-hidden bg-white shadow-sm"
      data-page={pageNumber}
      ref={ref}
      style={
        {
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
          "--total-scale-factor": scale,
          height,
          width,
        } as React.CSSProperties
      }
    >
      <canvas
        className="absolute inset-0"
        ref={canvasRef}
        style={{ height, width }}
      />
      <div
        className="textLayer"
        data-quote-source={`课件第 ${pageNumber} 页`}
        ref={textRef}
      />
    </div>
  );
}
