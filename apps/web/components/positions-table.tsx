import type { PositionRiskView } from "@xichu-risk/shared";

import { RiskBadge } from "@/components/risk-badge";
import { assetTypeLabel, formatCurrency, formatPercent, themeLabel } from "@/lib/formatters";

export function PositionsTable({ positions }: { positions: PositionRiskView[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table positions-table">
        <thead>
          <tr>
            <th>代码</th>
            <th>名称</th>
            <th>类型</th>
            <th>主题</th>
            <th className="number-cell">成本金额</th>
            <th className="number-cell">当前市值</th>
            <th className="number-cell">浮盈亏</th>
            <th className="number-cell">浮盈亏 %</th>
            <th className="number-cell">仓位 %</th>
            <th>风险等级</th>
            <th>建议动作</th>
          </tr>
        </thead>
        <tbody>
          {positions.length === 0 ? (
            <tr>
              <td className="instrument-name" colSpan={11}>
                当前账户暂无持仓
              </td>
            </tr>
          ) : positions.map((position) => (
            <tr key={position.id}>
              <td>
                <strong className="symbol">{position.symbol}</strong>
              </td>
              <td className="instrument-name">{position.name}</td>
              <td>
                <span
                  className={[
                    "asset-tag",
                    position.assetType === "LEVERAGED_ETF" ? "asset-tag--danger" : "",
                  ].join(" ")}
                >
                  {assetTypeLabel(position.assetType)}
                </span>
              </td>
              <td>{themeLabel(position.theme)}</td>
              <td className="number-cell mono">{formatCurrency(position.costAmount)}</td>
              <td className="number-cell mono">{formatCurrency(position.marketValue)}</td>
              <td
                className={[
                  "number-cell",
                  "mono",
                  position.unrealizedPnl < 0 ? "loss-text" : "profit-text",
                ].join(" ")}
              >
                {formatCurrency(position.unrealizedPnl)}
              </td>
              <td
                className={[
                  "number-cell",
                  "mono",
                  position.unrealizedPnlPercent < 0 ? "loss-text" : "profit-text",
                ].join(" ")}
              >
                {formatPercent(position.unrealizedPnlPercent)}
              </td>
              <td className="number-cell mono">{formatPercent(position.positionPercent)}</td>
              <td>
                <RiskBadge level={position.riskLevel} />
              </td>
              <td className="action-cell">{position.suggestedAction}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
