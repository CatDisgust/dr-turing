import { AdminPanel } from "./admin-panel";

export const metadata = { title: "管理 · Dr.Turing" };

export default function AdminPage() {
  return (
    <main className="mx-auto flex max-w-[960px] flex-col gap-8 px-4 py-10">
      <AdminPanel />
    </main>
  );
}
