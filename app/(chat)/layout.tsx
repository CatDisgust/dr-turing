import { cookies } from "next/headers";
import Script from "next/script";
import { Suspense } from "react";
import { Toaster } from "sonner";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { DataStreamProvider } from "@/components/chat/data-stream-provider";
import { ChatShell } from "@/components/chat/shell";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ActiveChatProvider } from "@/hooks/use-active-chat";
import { auth } from "@/lib/session";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js"
        strategy="lazyOnload"
      />
      <DataStreamProvider>
        <Suspense fallback={<div className="flex h-dvh bg-sidebar" />}>
          <SidebarShell>{children}</SidebarShell>
        </Suspense>
      </DataStreamProvider>
    </>
  );
}

async function SidebarShell({ children }: { children: React.ReactNode }) {
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  // 侧边栏放着「我的课」：试用同学第一次来默认展开；管理员和演示（录视频）照旧默认收起
  const saved = cookieStore.get("sidebar_state")?.value;
  const open =
    saved === undefined ? session.role === "trial" : saved === "true";

  return (
    <SidebarProvider defaultOpen={open}>
      {/* 侧边栏要知道这次对话学哪门课、点课名开新对话，所以和对话共用一份状态 */}
      <Suspense fallback={<div className="flex h-dvh w-full bg-sidebar" />}>
        <ActiveChatProvider>
          <AppSidebar user={session?.user} />
          <SidebarInset className="min-w-0">
            <Toaster
              position="top-center"
              theme="system"
              toastOptions={{
                className:
                  "!bg-card !text-foreground !border-border/50 !shadow-[var(--shadow-float)]",
              }}
            />
            <ChatShell />
            {children}
          </SidebarInset>
        </ActiveChatProvider>
      </Suspense>
    </SidebarProvider>
  );
}
