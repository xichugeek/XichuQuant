/** Provenance is independent of storage (SQL Server does not imply live data). */
export const DATA_ORIGINS = ["DEMO", "SYNTHETIC", "HISTORICAL", "INTERNAL_PAPER", "IBKR_PAPER", "LIVE_READ_ONLY"] as const;
export type DataOrigin = (typeof DATA_ORIGINS)[number];
export const DATA_ORIGIN_LABELS: Record<DataOrigin, string> = {
  DEMO: "虚构演示账户", SYNTHETIC: "合成测试数据", HISTORICAL: "历史导入数据",
  INTERNAL_PAPER: "内部模拟账本", IBKR_PAPER: "IBKR 券商模拟账户", LIVE_READ_ONLY: "真实账户只读",
};
