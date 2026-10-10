"use client";

import { LoaderCircle, Save, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Panel } from "@/components/panel";
import { getJson, patchJson } from "@/lib/api-client";
import type { BrokerDashboard } from "@/lib/broker-types";

export function BrokerSettingsPanel() {
  const [data, setData] = useState<BrokerDashboard | null>(null);
  const [runMode, setRunMode] = useState("OFFLINE");
  const [safetyState, setSafetyState] = useState("READ_ONLY");
  const [autoReconciliation, setAutoReconciliation] = useState(false);
  const [shadowTradingEnabled, setShadowTradingEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const dashboard = await getJson<BrokerDashboard>("/broker/dashboard");
      setData(dashboard);
      setRunMode(dashboard.connection.runMode);
      setSafetyState(dashboard.connection.safetyState);
      setAutoReconciliation(dashboard.connection.autoReconciliation);
      setShadowTradingEnabled(dashboard.connection.shadowTradingEnabled);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Broker 设置 API 不可用");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function save() {
    if (
      safetyState === "SHADOW_ONLY" &&
      !window.confirm("确认手动进入 SHADOW_ONLY？系统仍不会发送券商订单。")
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await patchJson("/broker/settings", {
        acknowledgeNoBrokerWrites: true,
        autoReconciliation,
        operatorId: "local-admin",
        reason: "用户在系统设置页手动更新 V1.7 只读运行模式",
        runMode,
        safetyState,
        shadowTradingEnabled,
      });
      setMessage("设置和操作人已写入 Broker 审计日志。系统仍无任何券商写能力。");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存 Broker 设置失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      description="默认 OFFLINE / READ_ONLY；不提供 LIVE_TRADING 或 AUTO_TRADING 入口"
      title="IBKR 只读与影子模式"
    >
      {!data && !error ? (
        <div className="detail-loading">
          <LoaderCircle className="spin" size={18} />
          正在读取只读连接设置…
        </div>
      ) : null}
      {error ? <p className="is-danger">{error}</p> : null}
      {data ? (
        <div className="v17-settings-form">
          <div className="v17-settings-summary">
            <ShieldCheck size={18} />
            <span>
              <b>{data.connection.displayName}</b>
              <small>
                {data.connection.status} · {data.connection.connectorUrl} · 账户{" "}
                {data.accounts[0]?.maskedAccountNumber ?? "尚未同步"} · 心跳{" "}
                {data.connection.lastHeartbeatAt
                  ? new Date(data.connection.lastHeartbeatAt).toLocaleString("zh-CN")
                  : "—"}
              </small>
            </span>
          </div>
          <div className={data.control.killSwitchEnabled ? "v17-stale-banner" : "v17-disclaimer"}>
            <ShieldCheck size={16} />
            <b>全局 Kill Switch</b>
            <span>
              {data.control.killSwitchEnabled
                ? data.control.reason ?? "已启用"
                : "未启用；RiskEngine 与 LOCKDOWN 仍独立生效"}
            </span>
          </div>
          <label>
            <span>运行模式</span>
            <select value={runMode} onChange={(event) => setRunMode(event.target.value)}>
              <option value="OFFLINE">OFFLINE</option>
              <option value="MOCK">MOCK</option>
              <option value="PAPER">PAPER</option>
              <option value="SHADOW">SHADOW</option>
              <option value="READ_ONLY_LIVE">READ_ONLY_LIVE</option>
            </select>
          </label>
          <label>
            <span>安全状态</span>
            <select value={safetyState} onChange={(event) => setSafetyState(event.target.value)}>
              <option value="NORMAL">NORMAL</option>
              <option value="READ_ONLY">READ_ONLY</option>
              <option value="SHADOW_ONLY">SHADOW_ONLY</option>
              <option value="LOCKDOWN">LOCKDOWN</option>
            </select>
          </label>
          <label className="v17-check">
            <input
              checked={autoReconciliation}
              onChange={(event) => setAutoReconciliation(event.target.checked)}
              type="checkbox"
            />
            <span>同步后自动生成对账差异（不会自动覆盖本地数据）</span>
          </label>
          <label className="v17-check">
            <input
              checked={shadowTradingEnabled}
              onChange={(event) => setShadowTradingEnabled(event.target.checked)}
              type="checkbox"
            />
            <span>
              允许影子任务（还需 SHADOW_ONLY、最新数据、RiskEngine 和 Kill Switch 全部通过）
            </span>
          </label>
          <div className="v17-settings-capabilities">
            {Object.entries(data.connection.capabilities).map(([key, enabled]) => (
              <span key={key}>
                <b>{key}</b>
                <em className={enabled ? "is-success" : "is-danger"}>
                  {enabled ? "允许" : "禁止"}
                </em>
              </span>
            ))}
          </div>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void save()}
            type="button"
          >
            {busy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保存只读设置
          </button>
          {message ? <p className="quant-message">{message}</p> : null}
        </div>
      ) : null}
    </Panel>
  );
}
