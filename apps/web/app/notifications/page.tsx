"use client";

import { BellRing, CheckCheck, CircleAlert, LoaderCircle, RefreshCw, ServerCrash, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { getJson, patchJson } from "@/lib/api-client";

type Notification = {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  status: string;
  sourceTaskId: string | null;
  createdAt: string;
  readAt: string | null;
  metadata: Record<string, unknown> | null;
};

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setItems(await getJson<Notification[]>("/operations/notifications")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "通知 API 不可用"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function markRead(id?: string) {
    setBusy(true);
    try { await patchJson("/operations/notifications/read", id ? { id } : {}); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "通知状态更新失败"); }
    finally { setBusy(false); }
  }

  const unread = items.filter((item) => item.status === "UNREAD");
  const critical = unread.filter((item) => item.severity === "CRITICAL").length;
  const warnings = unread.filter((item) => item.severity === "WARNING").length;

  return (
    <>
      <PageHeader description="行情、数据质量、Quant Engine、RiskEngine、回撤、策略偏差与 Kill Switch 的系统内提醒" title="通知中心" />
      {error ? <div className="service-error"><ServerCrash size={18} />{error}</div> : null}
      <div className="v15-action-bar v15-action-bar--end">
        <button disabled={busy} onClick={() => void refresh()} type="button"><RefreshCw size={15} />刷新</button>
        <button className="primary-button" disabled={busy || unread.length === 0} onClick={() => void markRead()} type="button"><CheckCheck size={16} />全部标为已读</button>
      </div>
      <div className="paper-kpis">
        <article><span>通知总数</span><strong>{items.length}</strong><small>完整审计记录</small></article>
        <article><span>未读</span><strong>{unread.length}</strong><small>需要关注</small></article>
        <article><span>严重异常</span><strong className="is-danger">{critical}</strong><small>默认停止运行</small></article>
        <article><span>警告</span><strong>{warnings}</strong><small>持续观察</small></article>
        <article><span>行情/数据</span><strong>{items.filter((item) => item.type.includes("DATA") || item.type.includes("MARKET")).length}</strong><small>同步质量</small></article>
        <article><span>策略偏差</span><strong>{items.filter((item) => item.type === "FORWARD_DEVIATION").length}</strong><small>前向 vs 回测</small></article>
      </div>
      <Panel description="V1.5 仅提供系统内通知，不发送短信、邮件或第三方消息" title="异常提醒">
        {loading && items.length === 0 ? <div className="detail-loading"><LoaderCircle className="spin" size={20} />正在读取系统通知…</div> : null}
        <div className="v15-notification-list">{items.map((item) => <article className={`${item.status === "UNREAD" ? "is-unread" : ""} is-${item.severity.toLowerCase()}`} key={item.id}><span className="v15-notification-icon">{item.severity === "CRITICAL" ? <ShieldAlert size={18} /> : item.severity === "WARNING" ? <CircleAlert size={18} /> : <BellRing size={18} />}</span><div><header><b>{item.title}</b><em>{item.severity}</em><time>{new Date(item.createdAt).toLocaleString("zh-CN")}</time></header><p>{item.message}</p><small>{item.type}{item.sourceTaskId ? ` · 任务 ${item.sourceTaskId.slice(0, 8)}` : ""}</small></div>{item.status === "UNREAD" ? <button disabled={busy} onClick={() => void markRead(item.id)} type="button">标为已读</button> : <span className="v15-read"><CheckCheck size={14} />已读</span>}</article>)}</div>
        {items.length === 0 && !loading ? <div className="empty-state">当前没有系统通知</div> : null}
      </Panel>
    </>
  );
}
