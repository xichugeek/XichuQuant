"use client";

import { LockKeyhole, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";

import { postJson } from "@/lib/api-client";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await postJson("/auth/login", { password, username });
      window.location.assign("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <header>
          <span><ShieldCheck size={25} /></span>
          <div><h1>XichuQuant / 西楚量化交易系统</h1><p>生产安全登录</p></div>
        </header>
        <div className="v18-paper-boundary">
          <LockKeyhole size={17} />
          <span><b>IBKR PAPER ONLY</b><small>本会话无任何 Live 券商写能力。</small></span>
        </div>
        <label><span>用户名</span><input autoComplete="username" onChange={(event) => setUsername(event.target.value)} required value={username} /></label>
        <label><span>密码</span><input autoComplete="current-password" minLength={12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
        {error ? <p className="login-error" role="alert">{error}</p> : null}
        <button disabled={busy} type="submit">{busy ? "正在验证…" : "安全登录"}</button>
        <small>连续失败 5 次将锁定 15 分钟；会话最长 24 小时，不在 localStorage 保存令牌。</small>
      </form>
    </main>
  );
}
