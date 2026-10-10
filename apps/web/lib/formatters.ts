const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  style: "currency",
});

export function formatCurrency(value: number | null): string {
  if (value === null) return "未核实";
  const absolute = currencyFormatter.format(Math.abs(value));
  return value < 0 ? "-" + absolute : absolute;
}

export function formatPercent(value: number | null, digits = 2): string {
  if (value === null) return "未核实";
  return value.toFixed(digits) + "%";
}

export function assetTypeLabel(assetType: string): string {
  return (
    {
      ETF: "ETF",
      LEVERAGED_ETF: "杠杆 ETF",
      STOCK: "个股",
    }[assetType] ?? assetType
  );
}

export function themeLabel(theme: string | null): string {
  if (!theme) return "未分类";
  return (
    {
      BIG_TECH: "七姐妹",
      CORE_INDEX: "核心指数",
      STORAGE: "存储",
    }[theme] ?? theme
  );
}
