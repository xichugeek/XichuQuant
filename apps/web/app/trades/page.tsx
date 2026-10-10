import type { TradeView } from "@xichu-risk/shared";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { formatCurrency } from "@/lib/formatters";
import { fetchWithFallback } from "@/lib/server-api-client";
import { mockTrades } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

export default async function TradesPage() {
  const result = await fetchWithFallback<TradeView[]>("/trades", mockTrades);
  const trades = result.data;
  return (
    <>
      <PageHeader
        action={
          <button className="primary-button" type="button">
            <Plus aria-hidden="true" size={14} />
            记录交易
          </button>
        }
        description="记录交易方向、金额、情绪标签和纪律执行结果"
        title="交易记录"
      />

      <Panel
        description={
          result.source === "api" ? "交易记录来自 SQL Server" : "API 未连接，当前显示 Mock fallback"
        }
        title="最近交易"
      >
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>交易日期</th>
                <th>代码</th>
                <th>方向</th>
                <th className="number-cell">数量</th>
                <th className="number-cell">价格</th>
                <th className="number-cell">金额</th>
                <th>情绪标签</th>
                <th>是否遵守纪律</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr key={trade.id}>
                  <td>{trade.date}</td>
                  <td>
                    <strong className="symbol">{trade.symbol}</strong>
                  </td>
                  <td>
                    <span className="asset-tag">{trade.side}</span>
                  </td>
                  <td className="number-cell mono">{trade.quantity}</td>
                  <td className="number-cell mono">{formatCurrency(trade.price)}</td>
                  <td className="number-cell mono">{formatCurrency(trade.amount)}</td>
                  <td>{trade.emotion}</td>
                  <td>
                    <span
                      className={[
                        "rule-followed",
                        trade.followedRule ? "rule-followed--yes" : "rule-followed--no",
                      ].join(" ")}
                    >
                      {trade.followedRule ? "已遵守" : "未遵守"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
