"use client";

import { useSearchParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

// 邀请码登录：输一次就记住。链接里带 ?code= 的直接替他填好登录
export function LoginForm() {
  const params = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = useCallback(async (value: string) => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", {
      body: JSON.stringify({ code: value }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }).catch(() => null);
    if (res?.ok) {
      window.location.href = "/";
      return;
    }
    const body = (await res?.json().catch(() => null)) as {
      error?: string;
    } | null;
    setError(body?.error ?? "网络出错了，再试一次");
    setBusy(false);
  }, []);

  useEffect(() => {
    const fromLink = params.get("code");
    if (fromLink) {
      login(fromLink);
    }
  }, [params, login]);

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      login(code);
    },
    [code, login]
  );

  const onChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setCode(event.target.value),
    []
  );

  return (
    <form
      className="flex w-full max-w-[360px] flex-col gap-5"
      data-testid="login-form"
      onSubmit={submit}
    >
      <div className="flex flex-col gap-2">
        <h1 className="font-bold text-[26px] tracking-[-0.01em]">Dr.Turing</h1>
        <p className="text-[15px] text-muted-foreground">
          输入你收到的邀请码，之后这台设备会记住你。
        </p>
      </div>
      <input
        autoCapitalize="none"
        autoComplete="off"
        autoFocus
        className="dt-input h-12 px-4"
        data-testid="login-code"
        onChange={onChange}
        placeholder="比如 ming-7k3p2x"
        spellCheck={false}
        value={code}
      />
      {error ? (
        <p
          className="text-[14px] text-[var(--duo-red-ink)]"
          data-testid="login-error"
        >
          {error}
        </p>
      ) : null}
      <button
        className="dt-btn dt-btn-primary w-full"
        data-testid="login-submit"
        disabled={busy || !code.trim()}
        type="submit"
      >
        {busy ? "进入中…" : "进入"}
      </button>
    </form>
  );
}
