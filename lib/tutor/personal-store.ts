import "server-only";
import {
  getConceptEvents,
  getPersonalGraph,
  saveConceptEvents,
} from "@/lib/db/queries";
import {
  eventsFromLegacy,
  personalFromEvents,
  stamp,
} from "@/lib/learner/personal";
import type {
  ConceptEventPayload,
  ConceptEventType,
  PersonalGraph,
} from "@/lib/types";

// 个人知识库的读写都走日志：读的时候从日志算图；旧的 PersonalGraph 表第一次读到时导进日志

export async function loadPersonal(studentId: string) {
  let events = await getConceptEvents({ studentId });
  if (events.length === 0) {
    const legacy = await getPersonalGraph({ studentId });
    if (legacy && legacy.concepts.length > 0) {
      events = eventsFromLegacy(legacy, () => crypto.randomUUID());
      await saveConceptEvents(events);
    }
  }
  return { events, graph: personalFromEvents(studentId, events) };
}

export async function appendPersonal(
  studentId: string,
  sessionId: string | null,
  drafts: {
    conceptId: string;
    type: ConceptEventType;
    payload: ConceptEventPayload;
  }[]
): Promise<PersonalGraph> {
  await saveConceptEvents(
    stamp(drafts, { now: new Date().toISOString(), sessionId, studentId }, () =>
      crypto.randomUUID()
    )
  );
  return (await loadPersonal(studentId)).graph;
}
