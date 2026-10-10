"use client";

import { Ban, CheckCircle2, LoaderCircle, RadioTower, Send, ServerCrash, ShieldCheck, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { fetchWithFallback, patchJson, postJson, type DataSource } from "@/lib/api-client";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import type { StrategySignalView, StrategyView } from "@/lib/quant-types";

export default function SignalsPage() {
  const [signals, setSignals] = useState<StrategySignalView[]>([]);
  const [strategies, setStrategies] = useState<StrategyView[]>([]);
  const [source, setSource] = useState<DataSource>("mock");
  const [strategyId, setStrategyId] = useState("");
  const [symbol, setSymbol] = useState("MUU");
  const [amount, setAmount] = useState("2000");
  const [price, setPrice] = useState("22.29");
  const [stop, setStop] = useState("跌破 20 美元退出");
  const [exit, setExit] = useState("触发风险红线或达到目标后退出");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const [signalResult, strategyResult] = await Promise.all([
      fetchWithFallback<StrategySignalView[]>("/signals", []),
      fetchWithFallback<StrategyView[]>("/strategies", []),
    ]);
    setSignals(signalResult.data);
    setStrategies(strategyResult.data);
    setSource(signalResult.source === "api" && strategyResult.source === "api" ? "api" : "mock");
    setStrategyId((current) => current || strategyResult.data[0]?.id || "");
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([
      fetchWithFallback<StrategySignalView[]>("/signals", []),
      fetchWithFallback<StrategyView[]>("/strategies", []),
    ]).then(([signalResult, strategyResult]) => {
      if (!active) return;
      setSignals(signalResult.data);
      setStrategies(strategyResult.data);
      setSource(signalResult.source === "api" && strategyResult.source === "api" ? "api" : "mock");
      setStrategyId(strategyResult.data[0]?.id ?? "");
    });
    return () => { active = false; };
  }, []);

  async function createSignal() {
    setBusy(true);
    setMessage("");
    try {
      const signal = await postJson<StrategySignalView>("/signals", {
        strategyId,
        accountId: "account-ibkr",
        symbol,
        signalType: "BUY",
        requestedAmount: Number(amount),
        referencePrice: Number(price),
        stopLossCondition: stop,
        exitCondition: exit,
        triggerReason: "人工提交的策略信号验收",
      });
      setMessage(signal.status === "RISK_REJECTED" ? `信号已拒绝：${signal.rejectionReason}` : "信号已通过风控，仅可进行模拟标记。 ");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "信号审查失败");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(id: string) {
    await patchJson(`/signals/${id}/status`, { status: "MANUALLY_DISMISSED" });
    await refresh();
  }

  const rejected = signals.filter((signal) => signal.status === "RISK_REJECTED").length;
  const approved = signals.filter((signal) => signal.status === "RISK_APPROVED").length;
  return (
    <>
      <PageHeader description="策略只生成 TradeIntent；所有买入必须结合当前真实账户通过 NestJS RiskEngine" title="策略信号中心" />
      {source === "mock" ? <div className="service-error"><ServerCrash size={18} />信号 API 不可用，系统不会显示伪造审批结果，也不会向 IBKR 发送任何订单。</div> : null}
      <div className="quant-stat-grid">
        <article><span>全部信号</span><strong>{signals.length}</strong><small>含历史回测信号</small></article>
        <article><span>风控拒绝</span><strong className="is-danger">{rejected}</strong><small>不允许执行</small></article>
        <article><span>风控通过</span><strong className="is-success">{approved}</strong><small>仍需人工决定</small></article>
        <article><span>自动下单</span><strong>0</strong><small>系统无券商发送能力</small></article>
      </div>
      <Panel description="默认填入 V1.3 验收场景：买入 MUU $2,000；后端计算买入后的真实账户仓位" title="提交买入信号审查">
        <div className="signal-form">
          <label><span>来源策略</span><select onChange={(event) => setStrategyId(event.target.value)} value={strategyId}>{strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}</select></label>
          <label><span>代码</span><input onChange={(event) => setSymbol(event.target.value.toUpperCase())} value={symbol} /></label>
          <label><span>计划金额</span><input min="0" onChange={(event) => setAmount(event.target.value)} type="number" value={amount} /></label>
          <label><span>参考价格</span><input min="0" onChange={(event) => setPrice(event.target.value)} step="0.01" type="number" value={price} /></label>
          <label><span>止损条件</span><input onChange={(event) => setStop(event.target.value)} value={stop} /></label>
          <label><span>退出条件</span><input onChange={(event) => setExit(event.target.value)} value={exit} /></label>
          <button className="primary-button" disabled={busy || source !== "api" || !strategyId} onClick={() => void createSignal()} type="button">{busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}提交 RiskEngine</button>
        </div>
        {message ? <p className="quant-message">{message}</p> : null}
      </Panel>
      <div className="signal-list">
        {signals.map((signal) => (
          <article className={`signal-card signal-card--${signal.status.toLowerCase()}`} key={signal.id}>
            <header>
              <span className="signal-icon">{signal.status === "RISK_REJECTED" ? <XCircle size={19} /> : signal.status === "RISK_APPROVED" ? <CheckCircle2 size={19} /> : <RadioTower size={19} />}</span>
              <div><strong>{signal.signalType} {signal.symbol}</strong><small>{signal.strategy?.name ?? signal.strategyId} · {new Date(signal.signalTime).toLocaleString("zh-CN")}</small></div>
              <em className={`quant-status quant-status--${signal.status.toLowerCase()}`}>{signal.status}</em>
            </header>
            <div className="signal-summary"><span>计划金额 <b>{formatCurrency(signal.requestedAmount ?? 0)}</b></span><span>参考价格 <b>{formatCurrency(signal.referencePrice ?? 0)}</b></span><span>账户 <b>{signal.account?.name ?? "IBKR 美股账户"}</b></span></div>
            <p>{signal.rejectionReason ?? signal.riskResult?.message ?? signal.triggerReason}</p>
            {signal.riskResult?.violations.length ? <div className="violation-table"><div className="violation-head"><span>规则</span><span>当前值</span><span>预计值</span><span>限制值</span><span>拒绝原因</span></div>{signal.riskResult.violations.map((violation) => <div key={violation.code}><code>{violation.code}</code><span>{violation.currentValue === null ? "-" : formatPercent(violation.currentValue)}</span><span>{violation.expectedValue === null ? "-" : formatPercent(violation.expectedValue)}</span><span>{violation.limitValue === null ? "-" : formatPercent(violation.limitValue)}</span><strong>{violation.reason}</strong></div>)}</div> : null}
            <footer><span><ShieldCheck size={14} />{signal.stopLossCondition || "未填写止损"} · {signal.exitCondition || "未填写退出"}</span>{!["MANUALLY_DISMISSED", "PAPER_EXECUTED"].includes(signal.status) ? <button onClick={() => void dismiss(signal.id)} type="button"><Ban size={13} />人工忽略</button> : null}</footer>
          </article>
        ))}
      </div>
    </>
  );
}
