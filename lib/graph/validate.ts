import {
  type KnowledgePoint,
  knowledgeKindSchema,
  type Source,
} from "@/lib/types";
import type { DraftPoint } from "./extract";

// 纯函数，不调模型：无出处不收，再拿 PDF 每页的文字核对页码

export type PageCheck = {
  pointId: string;
  page: number;
  quote: string;
  // match 原文在这页；fuzzy 大部分词在这页；mismatch 不在；no-text 这页没抽出文字（多半是图）
  status: "match" | "fuzzy" | "mismatch" | "no-text";
  // mismatch 时，原文实际出现在哪些页
  foundOn: number[];
};

export type ValidationResult = {
  accepted: KnowledgePoint[];
  rejected: { name: string; reason: string }[];
  checks: PageCheck[];
};

// PDF 抽出来的文字常丢空格（"Thismaterialhasbeen"），比较时只留字母数字
const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);

function quoteStatus(
  quote: string,
  pageText: string
): "match" | "fuzzy" | "mismatch" | "no-text" {
  const page = squash(pageText);
  if (page.length < 20) {
    return "no-text";
  }
  const q = squash(quote);
  if (q.length > 0 && page.includes(q)) {
    return "match";
  }
  const quoteWords = words(quote);
  if (quoteWords.length === 0) {
    return "mismatch";
  }
  const hits = quoteWords.filter((word) => page.includes(word)).length;
  return hits / quoteWords.length >= 0.8 ? "fuzzy" : "mismatch";
}

export function validatePoints(
  drafts: DraftPoint[],
  lesson: { id: string; fileId: string },
  pageTexts: string[]
): ValidationResult {
  const accepted: KnowledgePoint[] = [];
  const rejected: ValidationResult["rejected"] = [];
  const checks: PageCheck[] = [];

  drafts.forEach((draft, index) => {
    const id = `kp_${lesson.id}_${index + 1}`;
    if (!draft.name.trim()) {
      rejected.push({ name: "(无名)", reason: "没有名字" });
      return;
    }

    const sources: Source[] = draft.sources
      .filter(
        (source) =>
          source.quote.trim() &&
          source.page >= 1 &&
          source.page <= pageTexts.length
      )
      .map((source) => ({
        fileId: lesson.fileId,
        lessonId: lesson.id,
        page: source.page,
        quote: source.quote.trim(),
      }));

    if (sources.length === 0) {
      rejected.push({
        name: draft.name,
        reason:
          draft.sources.length === 0 ? "没有出处" : "出处页码超出课件范围",
      });
      return;
    }

    for (const source of sources) {
      const status = quoteStatus(source.quote, pageTexts[source.page - 1]);
      const foundOn =
        status === "mismatch"
          ? pageTexts.flatMap((text, i) =>
              quoteStatus(source.quote, text) === "match" ? [i + 1] : []
            )
          : [];
      checks.push({
        foundOn,
        page: source.page,
        pointId: id,
        quote: source.quote,
        status,
      });
    }

    accepted.push({
      aliases: draft.aliases,
      checkQuestions: [],
      definition: draft.definition,
      id,
      // 模型偶尔写出四类以外的词，归到 concept
      kind: knowledgeKindSchema.catch("concept").parse(draft.kind),
      lessonId: lesson.id,
      name: draft.name.trim(),
      sources,
      status: "auto",
    });
  });

  return { accepted, checks, rejected };
}
