import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "输入邀请码 · Dr.Turing" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
