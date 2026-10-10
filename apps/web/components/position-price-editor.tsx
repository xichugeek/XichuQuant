"use client";

import type { PositionRiskView } from "@xichu-risk/shared";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { postJson, type DataSource } from "@/lib/api-client";

export function PositionPriceEditor({
  positions,
  source,
}: {
  positions: PositionRiskView[];
  source: DataSource;
}) {
  const router = useRouter();
  const [positionId, setPositionId] = useState(positions[0]?.id ?? "");
  const selected = useMemo(
    () => positions.find((position) => position.id === positionId) ?? positions[0],
    [positionId, positions],
  );
  const [price, setPrice] = useState(String(selected?.currentPrice ?? ""));
  const [status, setStatus] = useState(source === "api" ? "" : "API 未连接，价格更新暂不可用");
  const [saving, setSaving] = useState(false);

  function selectPosition(id: string) {
    setPositionId(id);
    const position = positions.find((item) => item.id === id);
    setPrice(String(position?.currentPrice ?? ""));
  }

  async function updatePrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentPrice = Number(price);
    if (source !== "api" || !positionId || !Number.isFinite(currentPrice) || currentPrice < 0)
      return;
    setSaving(true);
    setStatus("");
    try {
      await postJson(`/positions/${positionId}/update-price`, { currentPrice });
      setStatus("价格已保存，风控结果已重新计算");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "价格更新失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="quick-action-bar" onSubmit={(event) => void updatePrice(event)}>
      <span>
        <strong>手动更新价格</strong>
        <small>保存后由后端立即重算仓位、盈亏和风险报警</small>
      </span>
      <select onChange={(event) => selectPosition(event.target.value)} value={positionId}>
        {positions.map((position) => (
          <option key={position.id} value={position.id}>
            {position.symbol} · {position.name}
          </option>
        ))}
      </select>
      <input
        min="0"
        onChange={(event) => setPrice(event.target.value)}
        step="0.0001"
        type="number"
        value={price}
      />
      <button className="primary-button" disabled={saving || source !== "api"} type="submit">
        <RefreshCw aria-hidden="true" size={14} />
        {saving ? "保存中" : "更新并重算"}
      </button>
      {status ? <em>{status}</em> : null}
    </form>
  );
}
