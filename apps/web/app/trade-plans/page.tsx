"use client";

import type { RiskLevel, RiskSummary, TradePlanReviewResult } from "@xichu-risk/shared";
import { useEffect, useState, type FormEvent } from "react";

import { PageHeader } from "@/components/page-header";
import { fetchWithFallback, postJson, type DataSource } from "@/lib/api-client";
import { emptyRiskSummary } from "@/lib/operational-fallbacks";

type ReviewResult = {
  level: RiskLevel;
  message: string;
  passed: boolean;
  suggestedAction: string;
};

export default function TradePlansPage() {
  const [summary, setSummary] = useState<RiskSummary>(emptyRiskSummary);
  const [source, setSource] = useState<DataSource>("mock");
  const [symbol, setSymbol] = useState("AAPL");
  const [amount, setAmount] = useState("100");
  const [reason, setReason] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [allowAddPosition, setAllowAddPosition] = useState(false);
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const missingStopLoss = stopLoss.trim().length === 0;

  useEffect(() => {
    let active = true;
    void fetchWithFallback<RiskSummary>("/risk/summary", emptyRiskSummary).then((result) => {
      if (!active) return;
      setSummary(result.data);
      setSource(result.source);
    });
    return () => {
      active = false;
    };
  }, []);

  async function reviewPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (source !== "api") {
      setReviewResult({
        level: "WARNING",
        message: "API 暂不可用，不能使用示例数据代替真实账户进行审查。",
        passed: false,
        suggestedAction: "恢复 API 连接并刷新账户数据后重试。",
      });
      return;
    }

    if (summary.dataSource === "BROKER_SYNC") {
      setReviewResult({
        level: "WARNING",
        message: "当前是 IBKR Paper 同步账户，请在“券商模拟执行”页面创建受保护订单建议。",
        passed: false,
        suggestedAction: "使用 IBKR Paper 审批、二次确认与保护性止损流程。",
      });
      return;
    }

    if (missingStopLoss) {
      setReviewResult({
        level: "VIOLATION",
        message: "禁止开仓：未填写止损条件或退出条件。",
        passed: false,
        suggestedAction: "请先明确最大亏损、止损条件或退出条件。",
      });
      return;
    }

    const plannedAmount = Number(amount);
    if (!Number.isFinite(plannedAmount) || plannedAmount <= 0) {
      setReviewResult({
        level: "VIOLATION",
        message: "禁止开仓：计划买入金额必须大于 0。",
        passed: false,
        suggestedAction: "请填写有效的计划买入金额。",
      });
      return;
    }

    try {
      const plan = await postJson<{ id: string }>("/trade-plans", {
        accountId: summary.accountId,
        symbol,
        plannedAmount,
        reason,
        stopLossCondition: stopLoss,
        takeProfitCondition: takeProfit,
        allowAddPosition,
      });
      const review = await postJson<TradePlanReviewResult>(`/trade-plans/${plan.id}/review`);
      setReviewResult({
        level: review.level,
        message: review.messages.join("；"),
        passed: review.passed,
        suggestedAction: review.suggestedAction,
      });
      setSource("api");
      return;
    } catch (error) {
      setSource("mock");
      setReviewResult({
        level: "WARNING",
        message: error instanceof Error ? error.message : "后端审查失败，已安全拒绝。",
        passed: false,
        suggestedAction: "确认 API 与数据库正常后重新提交，禁止使用前端示例结果代替审查。",
      });
      return;
    }
  }

  return (
    <>
      <PageHeader
        description={`每次开仓前先回答：这笔交易会不会让我违反自己的纪律？ · ${source === "api" ? "后端持久化审查" : "API 暂不可用"}`}
        title="买入审查"
      />

      <div className="form-layout">
        <form className="business-form" onSubmit={reviewPlan}>
          <div className="form-section-title">
            <h2>新建买入计划</h2>
            <p>计划先保存，再由后端 RiskEngine 完成纪律审查。</p>
          </div>

          <div className="form-grid">
            <label>
              <span>股票代码</span>
              <input
                maxLength={16}
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                value={symbol}
              />
            </label>
            <label>
              <span>计划买入金额</span>
              <input
                min="0"
                onChange={(event) => setAmount(event.target.value)}
                step="0.01"
                type="number"
                value={amount}
              />
            </label>
            <label className="form-field--wide">
              <span>买入理由</span>
              <textarea
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                value={reason}
              />
            </label>
            <label className="form-field--wide">
              <span>
                止损条件 <em>必填</em>
              </span>
              <textarea
                className={missingStopLoss ? "input-error" : ""}
                onChange={(event) => setStopLoss(event.target.value)}
                placeholder="例如：跌破关键支撑位或最大亏损达到 5% 时退出"
                rows={3}
                value={stopLoss}
              />
              {missingStopLoss ? (
                <small className="field-error">禁止开仓：未填写止损条件或退出条件。</small>
              ) : null}
            </label>
            <label className="form-field--wide">
              <span>止盈条件</span>
              <textarea
                onChange={(event) => setTakeProfit(event.target.value)}
                placeholder="例如：达到目标收益或买入逻辑失效时退出"
                rows={2}
                value={takeProfit}
              />
            </label>
          </div>

          <label className="checkbox-field">
            <input
              checked={allowAddPosition}
              onChange={(event) => setAllowAddPosition(event.target.checked)}
              type="checkbox"
            />
            <span>是否允许补仓</span>
            <small>杠杆 ETF 亏损后默认禁止补仓。</small>
          </label>

          <div className="form-actions">
            <button className="primary-button" type="submit">
              提交纪律审查
            </button>
            <button className="secondary-button" disabled={!reviewResult?.passed} type="button">
              标记为已执行
            </button>
          </div>
        </form>

        <aside className="review-sidebar">
          <section className="review-context">
            <h2>当前账户风险</h2>
            <dl>
              <div>
                <dt>杠杆 ETF 仓位</dt>
                <dd className="loss-text">{summary.leveragedEtfPercent.toFixed(2)}%</dd>
              </div>
              <div>
                <dt>最大 Theme 有效总敞口</dt>
                <dd>{summary.maxRiskThemeEffectiveExposurePercent.toFixed(2)}%</dd>
              </div>
              <div>
                <dt>整体风险等级</dt>
                <dd>{summary.overallRiskLevel}</dd>
              </div>
            </dl>
          </section>

          <section
            className={[
              "review-result",
              reviewResult ? "review-result--" + reviewResult.level.toLowerCase() : "",
            ].join(" ")}
          >
            <small>审查结果</small>
            {reviewResult ? (
              <>
                <h2>{reviewResult.passed ? "允许开仓" : "禁止开仓"}</h2>
                <p>{reviewResult.message}</p>
                <strong>建议动作</strong>
                <span>{reviewResult.suggestedAction}</span>
              </>
            ) : (
              <>
                <h2>等待审查</h2>
                <p>填写交易计划后提交纪律审查。</p>
              </>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
