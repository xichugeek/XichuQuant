import { Injectable } from "@nestjs/common";

import { parseCsvRows } from "../imports/parser/csv-reader";
import { MARKET_DATA_FIELDS, resolveMarketField } from "./market-data-fields";

export type NormalizedMarketRow = {
  adjustedClose: number;
  close: number;
  currency: string;
  dividend: number;
  high: number;
  low: number;
  open: number;
  source: string;
  splitFactor: number;
  symbol: string;
  tradeDate: Date;
  volume: number;
};

export type ParsedMarketRecord = {
  errors: string[];
  normalized: NormalizedMarketRow | null;
  raw: Record<string, string>;
  sourceRow: number;
  status: "PENDING" | "VALID";
};

@Injectable()
export class MarketDataParserService {
  parse(content: string, fallbackSymbol?: string, source = "CSV_IMPORT") {
    const rows = parseCsvRows(content);
    if (rows.length < 2) throw new Error("CSV 至少需要表头和一行行情数据");
    const headers = rows[0]!;
    const mapping = Object.fromEntries(
      Object.entries(MARKET_DATA_FIELDS).map(([field, aliases]) => [
        field,
        resolveMarketField(headers, aliases),
      ]),
    ) as Record<keyof typeof MARKET_DATA_FIELDS, string | undefined>;
    const missing = ["tradeDate", "open", "high", "low", "close"].filter(
      (field) => !mapping[field as keyof typeof mapping],
    );
    if (!mapping.symbol && !fallbackSymbol) missing.push("symbol");
    if (missing.length > 0) throw new Error(`缺少必要字段映射：${missing.join(", ")}`);

    const parsed = rows.slice(1).map((values, rowIndex) => {
      const raw = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
      const value = (field: keyof typeof mapping) => {
        const header = mapping[field];
        return header ? (raw[header] ?? "") : "";
      };
      const number = (field: keyof typeof mapping, fallback = 0) => {
        const input = value(field).replaceAll(",", "").trim();
        return input === "" ? fallback : Number(input);
      };
      const tradeDate = new Date(`${value("tradeDate").trim()}T00:00:00.000Z`);
      const normalized: NormalizedMarketRow = {
        adjustedClose: number("adjustedClose", number("close")),
        close: number("close"),
        currency: value("currency") || "USD",
        dividend: number("dividend"),
        high: number("high"),
        low: number("low"),
        open: number("open"),
        source,
        splitFactor: number("splitFactor", 1),
        symbol: (value("symbol") || fallbackSymbol || "").trim().toUpperCase(),
        tradeDate,
        volume: number("volume"),
      };
      const errors = this.validate(normalized);
      return {
        errors,
        normalized: errors.length === 0 ? normalized : normalized,
        raw,
        sourceRow: rowIndex + 2,
        status: errors.length === 0 ? "VALID" : "PENDING",
      } satisfies ParsedMarketRecord;
    });

    return { headers, mapping, records: parsed };
  }

  validate(row: NormalizedMarketRow): string[] {
    const errors: string[] = [];
    if (!row.symbol) errors.push("股票代码不能为空");
    if (Number.isNaN(row.tradeDate.getTime())) errors.push("交易日期格式无效");
    for (const [name, price] of [
      ["开盘价", row.open],
      ["最高价", row.high],
      ["最低价", row.low],
      ["收盘价", row.close],
      ["复权收盘价", row.adjustedClose],
    ] as const) {
      if (!Number.isFinite(price) || price <= 0) errors.push(`${name}必须大于 0`);
    }
    if (row.high < row.low) errors.push("最高价不能低于最低价");
    if (row.open < row.low || row.open > row.high) errors.push("开盘价超出最高最低区间");
    if (row.close < row.low || row.close > row.high) errors.push("收盘价超出最高最低区间");
    if (!Number.isFinite(row.volume) || row.volume < 0) errors.push("成交量不能为负数");
    if (!Number.isFinite(row.dividend) || row.dividend < 0) errors.push("股息不能为负数");
    if (!Number.isFinite(row.splitFactor) || row.splitFactor <= 0) {
      errors.push("拆分因子必须大于 0");
    }
    return errors;
  }
}
