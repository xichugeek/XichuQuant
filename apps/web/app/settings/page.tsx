import type { AccountView, RiskLevel, RiskRuleView } from "@xichu-risk/shared";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { BrokerSettingsPanel } from "@/components/broker-settings-panel";
import { fetchWithFallback } from "@/lib/server-api-client";
import { formatCurrency } from "@/lib/formatters";
import { mockAccount, mockRules } from "@/lib/mock-data";

const levelLabels: Record<RiskLevel, string> = {
  LOW: "低风险",
  MEDIUM: "中风险",
  WARNING: "警告",
  DANGER: "高风险",
  VIOLATION: "严重违纪",
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [accountResult, ruleResult] = await Promise.all([
    fetchWithFallback<AccountView[]>("/accounts", [mockAccount]),
    fetchWithFallback<RiskRuleView[]>("/risk-rules", mockRules),
  ]);
  const account = accountResult.data[0] ?? mockAccount;
  const rules = ruleResult.data;
  return (
    <>
      <PageHeader description="维护本地账户参数与集中管理的风控规则" title="系统设置" />

      <section className="settings-grid">
        <BrokerSettingsPanel />
        <Panel
          description={
            accountResult.source === "api"
              ? "账户参数来自 SQL Server"
              : "API 未连接，当前显示 Mock fallback"
          }
          title="账户设置"
        >
          <dl className="settings-list">
            <div>
              <dt>账户名称</dt>
              <dd>{account.name}</dd>
            </div>
            <div>
              <dt>账户总资产</dt>
              <dd>{formatCurrency(account.totalEquity)}</dd>
            </div>
            <div>
              <dt>现金余额</dt>
              <dd>{formatCurrency(account.cashBalance)}</dd>
            </div>
            <div>
              <dt>今年已实现盈利</dt>
              <dd>{formatCurrency(account.realizedPnlYtd)}</dd>
            </div>
          </dl>
        </Panel>

        <Panel description="规则集中定义，不散落在页面中" title="风控规则">
          <div className="rules-list">
            {rules.map((rule) => (
              <div key={rule.code}>
                <span>
                  <strong>{rule.name}</strong>
                  <small>{rule.code}</small>
                </span>
                <em>
                  {rule.ruleType === "BOOLEAN"
                    ? rule.enabled
                      ? "启用"
                      : "停用"
                    : `${rule.limitValue}%`}
                </em>
                <span className="rule-level">{levelLabels[rule.level]}</span>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </>
  );
}
