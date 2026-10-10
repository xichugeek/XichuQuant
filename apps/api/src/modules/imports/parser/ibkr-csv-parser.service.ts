import { BadRequestException, Injectable } from "@nestjs/common";

import type { ImportRecordType, NormalizedImportRecord, ParsedImportFile } from "../import.types";
import { ActivityStatementAdapter } from "./activity-statement.adapter";
import { parseCsvRows } from "./csv-reader";
import { FlexQueryAdapter } from "./flex-query.adapter";
import { IBKR_FIELDS, INFORMATIONAL_SECTIONS, getField, normalizeHeader } from "./ibkr-field-map";
import type { IbkrCsvAdapter, IbkrRawRecord } from "./ibkr-adapter";
import {
  parseIbkrDate,
  parseIbkrNumber,
  sha256,
  splitRatioFromDescription,
  stableRecordId,
} from "./parser-utils";

@Injectable()
export class IbkrCsvParserService {
  private readonly adapters: IbkrCsvAdapter[] = [
    new ActivityStatementAdapter(),
    new FlexQueryAdapter(),
  ];

  parse(content: string): ParsedImportFile {
    if (!content.trim()) throw new BadRequestException("CSV 文件为空");
    const rows = parseCsvRows(content);
    const adapter = this.adapters.find((candidate) => candidate.canParse(rows));
    if (!adapter) {
      throw new BadRequestException(
        "无法识别 IBKR CSV 格式，请导出 Activity Statement CSV 或 Activity Flex Query CSV",
      );
    }

    const parsed = adapter.parse(rows);
    const defaultAccountId = parsed.accountIds.length === 1 ? parsed.accountIds[0]! : null;
    const records = parsed.records
      .filter((record) => !INFORMATIONAL_SECTIONS.has(record.section))
      .map((record) => this.normalizeRecord(record, defaultAccountId))
      .filter((record): record is NormalizedImportRecord => record !== null);

    if (records.length === 0) {
      throw new BadRequestException("CSV 中没有可预览的交易、持仓或现金记录");
    }

    const dates = records
      .map((record) => record.transactionDate)
      .filter((date): date is string => date !== null)
      .sort();
    return {
      adapter: parsed.adapter,
      fileHash: sha256(content.replace(/\r\n/g, "\n").trim()),
      externalAccountIds: parsed.accountIds,
      statementStart: parsed.statementStart ?? dates[0] ?? null,
      statementEnd: parsed.statementEnd ?? dates.at(-1) ?? null,
      records,
      ignoredRows: parsed.ignoredRows,
    };
  }

  private normalizeRecord(
    input: IbkrRawRecord,
    defaultAccountId: string | null,
  ): NormalizedImportRecord | null {
    const raw = input.values;
    const section = input.section;
    const externalAccountId = getField(raw, IBKR_FIELDS.accountId) || defaultAccountId;
    const symbol = cleanSymbol(getField(raw, IBKR_FIELDS.symbol));
    const description = getField(raw, IBKR_FIELDS.description) || null;
    const assetClass = getField(raw, IBKR_FIELDS.assetClass).toUpperCase() || null;
    const currency = getField(raw, IBKR_FIELDS.currency).toUpperCase() || "USD";
    const dateValue = getField(raw, IBKR_FIELDS.dateTime) || getField(raw, IBKR_FIELDS.reportDate);
    const transactionDate = parseIbkrDate(dateValue);
    const signedQuantity = parseIbkrNumber(
      getField(raw, section === "OPEN_POSITIONS" ? IBKR_FIELDS.position : IBKR_FIELDS.quantity),
    );
    const quantity = signedQuantity === null ? null : Math.abs(signedQuantity);
    const price = parseIbkrNumber(getField(raw, IBKR_FIELDS.price));
    const currentPrice = parseIbkrNumber(getField(raw, IBKR_FIELDS.closePrice));
    const rawCommission = parseIbkrNumber(getField(raw, IBKR_FIELDS.commission));
    const rawTaxes = parseIbkrNumber(getField(raw, IBKR_FIELDS.taxes));
    const commission = rawCommission === null ? null : Math.abs(rawCommission);
    const taxes = rawTaxes === null ? null : Math.abs(rawTaxes);
    const proceeds = parseIbkrNumber(getField(raw, IBKR_FIELDS.proceeds));
    const explicitNetCash = parseIbkrNumber(getField(raw, IBKR_FIELDS.netCash));
    const rawAmount = parseIbkrNumber(getField(raw, IBKR_FIELDS.amount));
    const costBasis = parseIbkrNumber(getField(raw, IBKR_FIELDS.costBasis));
    const marketValue = parseIbkrNumber(getField(raw, IBKR_FIELDS.marketValue));
    const realizedPnl = parseIbkrNumber(getField(raw, IBKR_FIELDS.realizedPnl));
    const unrealizedPnl = parseIbkrNumber(getField(raw, IBKR_FIELDS.unrealizedPnl));
    const fxRateToBase = parseIbkrNumber(getField(raw, IBKR_FIELDS.fxRateToBase));
    const actionValue = getField(raw, IBKR_FIELDS.action);
    const side = normalizeSide(actionValue, signedQuantity);
    const corporateActionType =
      getField(raw, IBKR_FIELDS.corporateActionType).toUpperCase() || null;
    const splitRatio = splitRatioFromDescription(description ?? "");
    const recordType = this.classifyRecord(
      section,
      actionValue,
      description,
      assetClass,
      rawAmount,
    );

    if (isSummaryRow(raw, symbol, transactionDate, rawAmount, marketValue)) return null;

    let amount =
      recordType === "TRADE" && quantity !== null && price !== null
        ? Math.abs(quantity * price)
        : rawAmount;
    if (recordType === "CASH_BALANCE" && amount === null) {
      amount = directNumeric(raw, ["Ending Cash", "Ending Settled Cash", "EndingCash"]);
    }
    if (recordType === "NAV_SNAPSHOT" && amount === null) {
      amount = directNumeric(raw, ["Ending Value", "Ending NAV", "Ending Value Total", "Total"]);
    }
    const netCash =
      explicitNetCash ??
      (recordType === "TRADE"
        ? calculateTradeNetCash({
            commission: rawCommission,
            proceeds,
            quantity,
            price,
            side,
            taxes: rawTaxes,
          })
        : rawAmount);
    const action =
      recordType === "TRADE"
        ? side
        : recordType === "CORPORATE_ACTION"
          ? corporateActionType
          : actionValue.toUpperCase() || null;
    const explicitId = getField(raw, IBKR_FIELDS.externalId);
    const externalId = stableRecordId({
      section,
      accountId: externalAccountId,
      explicitId,
      values: {
        action,
        amount,
        commission,
        currency,
        date: transactionDate,
        description,
        marketValue,
        price,
        quantity,
        recordType,
        realizedPnl,
        symbol,
      },
    });

    const normalized: NormalizedImportRecord = {
      sourceSection: section,
      sourceRow: input.sourceRow,
      recordType,
      externalId,
      externalAccountId,
      transactionDate,
      symbol,
      description,
      assetClass,
      currency,
      action,
      quantity,
      price,
      currentPrice,
      amount,
      netCash,
      commission,
      taxes,
      costBasis,
      marketValue,
      realizedPnl,
      unrealizedPnl,
      fxRateToBase,
      corporateActionType,
      splitRatio,
      raw,
      validationErrors: [],
    };
    normalized.validationErrors = validateNormalizedRecord(normalized);
    if (recordType === "POSITION" && signedQuantity !== null && signedQuantity < 0) {
      normalized.validationErrors.push("空头持仓暂不能自动核算，请人工确认");
    }
    return normalized;
  }

  private classifyRecord(
    section: string,
    action: string,
    description: string | null,
    assetClass: string | null,
    amount: number | null,
  ): ImportRecordType {
    if (section === "TRADES") {
      return /cash|forex|fx/i.test(assetClass ?? "") ? "FX_TRANSACTION" : "TRADE";
    }
    if (section === "OPEN_POSITIONS") return "POSITION";
    if (section === "DIVIDENDS") return "DIVIDEND";
    if (section === "WITHHOLDING_TAX") return "WITHHOLDING_TAX";
    if (section === "INTEREST") return "INTEREST";
    if (section === "FEES") return "COMMISSION";
    if (section === "CORPORATE_ACTIONS") return "CORPORATE_ACTION";
    if (section === "FOREX_PNL") return "FX_TRANSACTION";
    if (section === "CASH_REPORT") return "CASH_BALANCE";
    if (section === "NAV") return "NAV_SNAPSHOT";
    if (section === "DEPOSITS_WITHDRAWALS")
      return amount !== null && amount < 0 ? "WITHDRAWAL" : "DEPOSIT";
    if (section === "CASH_TRANSACTIONS") {
      const text = `${action} ${description ?? ""}`.toLowerCase();
      if (/withholding|withhold|tax/.test(text)) return "WITHHOLDING_TAX";
      if (/dividend|payment in lieu/.test(text)) return "DIVIDEND";
      if (/interest/.test(text)) return "INTEREST";
      if (/commission|fee/.test(text)) return "COMMISSION";
      if (/withdraw|disbursement|transfer out/.test(text)) return "WITHDRAWAL";
      if (/deposit|cash receipt|transfer in|wire/.test(text)) return "DEPOSIT";
      if (/forex|\bfx\b|currency conversion/.test(text)) return "FX_TRANSACTION";
    }
    return "UNKNOWN";
  }
}

export function validateNormalizedRecord(record: NormalizedImportRecord): string[] {
  const errors: string[] = [];
  if (record.recordType === "UNKNOWN") errors.push(`暂不支持的 IBKR 分区：${record.sourceSection}`);
  if (record.recordType === "TRADE") {
    if (!record.symbol) errors.push("交易记录缺少股票代码");
    if (!record.transactionDate) errors.push("交易记录缺少有效日期");
    if (record.quantity === null || record.quantity <= 0) errors.push("交易数量无效");
    if (record.price === null || record.price < 0) errors.push("交易价格无效");
    if (record.action !== "BUY" && record.action !== "SELL") errors.push("无法判断买入或卖出方向");
  }
  if (record.recordType === "POSITION") {
    if (!record.symbol) errors.push("持仓记录缺少股票代码");
    if (record.quantity === null) errors.push("持仓记录缺少数量");
    if (record.currentPrice === null && record.marketValue === null)
      errors.push("持仓记录缺少收盘价或市值");
    if (record.costBasis === null) errors.push("持仓记录缺少成本基础");
  }
  if (
    ["COMMISSION", "DIVIDEND", "WITHHOLDING_TAX", "INTEREST", "DEPOSIT", "WITHDRAWAL"].includes(
      record.recordType,
    )
  ) {
    if (!record.transactionDate) errors.push("现金记录缺少有效日期");
    if (record.amount === null) errors.push("现金记录缺少金额");
  }
  if (record.recordType === "CASH_BALANCE" && record.amount === null) {
    const endingCash = directNumeric(record.raw, [
      "Ending Cash",
      "Ending Settled Cash",
      "EndingCash",
    ]);
    if (endingCash === null) errors.push("现金余额记录缺少 Ending Cash");
    else record.amount = endingCash;
  }
  if (record.recordType === "NAV_SNAPSHOT" && record.amount === null) {
    const endingNav = directNumeric(record.raw, [
      "Ending Value",
      "Ending NAV",
      "Ending Value Total",
      "Total",
    ]);
    if (endingNav === null) errors.push("净值记录缺少 Ending NAV");
    else record.amount = endingNav;
  }
  if (record.recordType === "CORPORATE_ACTION") {
    if (!record.symbol) errors.push("公司行动缺少股票代码");
    if (
      ["CS", "FS", "RS"].includes(record.corporateActionType ?? "") &&
      record.splitRatio === null
    ) {
      errors.push("股票拆分记录缺少可识别的拆分比例，请人工确认");
    } else if (!["CS", "FS", "RS"].includes(record.corporateActionType ?? "")) {
      errors.push(`公司行动 ${record.corporateActionType ?? "未知类型"} 需要人工确认`);
    }
  }
  if (record.recordType === "FX_TRANSACTION" && record.netCash === null) {
    errors.push("外汇记录缺少可核对的 Net Cash/Amount，禁止自动换算");
  }
  return errors;
}

function normalizeSide(action: string, signedQuantity: number | null): "BUY" | "SELL" | null {
  const normalized = action.trim().toUpperCase();
  if (["BUY", "BOT", "B"].includes(normalized)) return "BUY";
  if (["SELL", "SLD", "S"].includes(normalized)) return "SELL";
  if (signedQuantity !== null) return signedQuantity < 0 ? "SELL" : "BUY";
  return null;
}

function cleanSymbol(value: string): string | null {
  const cleaned = value.trim().toUpperCase();
  if (!cleaned || /^TOTAL\b/.test(cleaned)) return null;
  return cleaned;
}

function calculateTradeNetCash(input: {
  commission: number | null;
  proceeds: number | null;
  quantity: number | null;
  price: number | null;
  side: "BUY" | "SELL" | null;
  taxes: number | null;
}): number | null {
  if (input.proceeds !== null) {
    return input.proceeds + (input.commission ?? 0) + (input.taxes ?? 0);
  }
  if (input.quantity === null || input.price === null || input.side === null) return null;
  const gross = input.quantity * input.price;
  const costs = Math.abs(input.commission ?? 0) + Math.abs(input.taxes ?? 0);
  return input.side === "BUY" ? -gross - costs : gross - costs;
}

function directNumeric(record: Record<string, string>, aliases: string[]): number | null {
  for (const [key, value] of Object.entries(record)) {
    if (aliases.some((alias) => normalizeHeader(alias) === normalizeHeader(key))) {
      const parsed = parseIbkrNumber(value);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function isSummaryRow(
  raw: Record<string, string>,
  symbol: string | null,
  transactionDate: string | null,
  amount: number | null,
  marketValue: number | null,
): boolean {
  const values = Object.values(raw).map((value) => value.trim().toLowerCase());
  const isTotal = values.some((value) => /^(total|sub-total|subtotal)$/.test(value));
  return isTotal && !symbol && !transactionDate && amount === null && marketValue === null;
}
