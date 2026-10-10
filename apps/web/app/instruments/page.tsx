import type { InstrumentView } from "@xichu-risk/shared";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { fetchWithFallback } from "@/lib/server-api-client";
import { mockInstruments } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

export default async function InstrumentsPage() {
  const result = await fetchWithFallback<InstrumentView[]>("/instruments", mockInstruments);
  const instruments = result.data;
  return (
    <>
      <PageHeader
        action={
          <button className="primary-button" type="button">
            <Plus aria-hidden="true" size={14} />
            新增标的
          </button>
        }
        description="统一维护标的、底层资产、Risk Theme、方向和有效杠杆倍数"
        title="标的管理"
      />

      <Panel
        description={
          result.source === "api"
            ? "标的主数据来自 SQL Server"
            : "API 未连接，当前显示 Mock fallback"
        }
        title="标的列表"
      >
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>代码</th>
                <th>名称</th>
                <th>资产类型</th>
                <th>分类</th>
                <th>主题</th>
                <th>底层 / 方向</th>
                <th>有效杠杆</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {instruments.map((instrument) => (
                <tr key={instrument.symbol}>
                  <td>
                    <strong className="symbol">{instrument.symbol}</strong>
                  </td>
                  <td>{instrument.name}</td>
                  <td>
                    <span
                      className={[
                        "asset-tag",
                        instrument.assetType === "LEVERAGED_ETF" ? "asset-tag--danger" : "",
                      ].join(" ")}
                    >
                      {instrument.assetType}
                    </span>
                  </td>
                  <td>{instrument.category}</td>
                  <td>{instrument.theme}</td>
                  <td>{instrument.underlyingSymbol ?? instrument.symbol}<br /><small>{instrument.direction}</small></td>
                  <td className="mono">
                    {instrument.leverageMultiplier ? `${instrument.leverageMultiplier}x` : "—"}<br />
                    <small>{instrument.riskTheme ?? "未分类"}</small>
                  </td>
                  <td>
                    <span
                      className={[
                        "rule-followed",
                        instrument.isActive ? "rule-followed--yes" : "rule-followed--no",
                      ].join(" ")}
                    >
                      {instrument.isActive ? "启用" : "停用"}
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
