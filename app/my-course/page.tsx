import { MyCourse } from "./my-course";

export const metadata = { title: "上传我的课 · Dr.Turing" };

export default function MyCoursePage() {
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-6 px-4 py-10">
      <MyCourse />
    </main>
  );
}
