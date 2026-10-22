import { Suspense } from "react";
import { CourseView } from "@/components/graph/course-view";

export default function CoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<main className="p-8 text-sm">加载图谱…</main>}>
      <Course params={params} />
    </Suspense>
  );
}

async function Course({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CourseView id={id} />;
}
