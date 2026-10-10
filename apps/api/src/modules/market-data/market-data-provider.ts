import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { MarketDataProvider } from "@prisma/client";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import type { NormalizedMarketRow } from "./market-data-parser.service";
import { UsMarketCalendarService, type UsMarketSession } from "./us-market-calendar.service";

export type ProviderHealth = {
  message: string;
  ok: boolean;
  rateLimit: { limit: number | null; remaining: number | null; resetsAt: string | null };
  version: string;
};

export type InstrumentMetadata = {
  currency: string;
  exchange: string | null;
  name: string;
  symbol: string;
};

export type CorporateAction = {
  amount: number;
  symbol: string;
  tradeDate: string;
  type: "DIVIDEND" | "SPLIT";
};

export interface MarketDataProviderAdapter {
  corporateActions(symbol: string, startDate: string, endDate: string): Promise<CorporateAction[]>;
  dailyRange(symbol: string, startDate: string, endDate: string): Promise<NormalizedMarketRow[]>;
  health(): Promise<ProviderHealth>;
  latestCompletedDaily(symbol: string, now?: Date): Promise<NormalizedMarketRow | null>;
  metadata(symbol: string): Promise<InstrumentMetadata>;
  tradingCalendar(startDate: string, endDate: string): Promise<UsMarketSession[]>;
}

@Injectable()
export class MarketDataProviderRegistry {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly calendar: UsMarketCalendarService,
  ) {}

  adapter(provider: MarketDataProvider): MarketDataProviderAdapter {
    if (provider.providerType === "SEED") {
      return new DatabaseMarketDataAdapter(this.prisma, this.calendar, provider);
    }
    if (provider.providerType === "HTTP_JSON") {
      return new ConfigurableHttpMarketDataAdapter(this.config, this.calendar, provider);
    }
    throw new BadRequestException(`${provider.name} 不支持自动同步，只能人工导入或预留`);
  }
}

class DatabaseMarketDataAdapter implements MarketDataProviderAdapter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: UsMarketCalendarService,
    private readonly provider: MarketDataProvider,
  ) {}

  async dailyRange(symbol: string, startDate: string, endDate: string) {
    const rows = await this.prisma.marketDataDaily.findMany({
      where: {
        providerId: this.provider.id,
        symbol: symbol.toUpperCase(),
        tradeDate: { gte: utcDate(startDate), lte: utcDate(endDate) },
      },
      orderBy: { tradeDate: "asc" },
    });
    return rows.map((row) => ({
      adjustedClose: toNumber(row.adjustedClose),
      close: toNumber(row.close),
      currency: row.currency,
      dividend: toNumber(row.dividend),
      high: toNumber(row.high),
      low: toNumber(row.low),
      open: toNumber(row.open),
      source: this.provider.code,
      splitFactor: toNumber(row.splitFactor),
      symbol: row.symbol,
      tradeDate: row.tradeDate,
      volume: toNumber(row.volume),
    }));
  }

  async latestCompletedDaily(symbol: string, now = new Date()) {
    const session = this.calendar.latestCompletedSession(now);
    const rows = await this.dailyRange(symbol, session.date, session.date);
    return rows[0] ?? null;
  }

  async metadata(symbol: string) {
    const instrument = await this.prisma.instrument.findUnique({ where: { symbol: symbol.toUpperCase() } });
    return {
      currency: "USD",
      exchange: null,
      name: instrument?.name ?? symbol.toUpperCase(),
      symbol: symbol.toUpperCase(),
    };
  }

  async corporateActions(symbol: string, startDate: string, endDate: string) {
    const rows = await this.dailyRange(symbol, startDate, endDate);
    return rows.flatMap<CorporateAction>((row) => {
      const actions: CorporateAction[] = [];
      const tradeDate = row.tradeDate.toISOString().slice(0, 10);
      if (row.dividend > 0) actions.push({ amount: row.dividend, symbol: row.symbol, tradeDate, type: "DIVIDEND" });
      if (row.splitFactor !== 1) actions.push({ amount: row.splitFactor, symbol: row.symbol, tradeDate, type: "SPLIT" });
      return actions;
    });
  }

  async tradingCalendar(startDate: string, endDate: string) {
    return this.calendar.tradingDays(startDate, endDate);
  }

  async health(): Promise<ProviderHealth> {
    return {
      message: "数据库 Seed 行情可用",
      ok: true,
      rateLimit: { limit: null, remaining: null, resetsAt: null },
      version: this.provider.providerVersion ?? "seed-v1.5",
    };
  }
}

type HttpProviderConfig = {
  apiKeyEnv?: string;
  baseUrlEnv?: string;
  dailyPathTemplate?: string;
  metadataPathTemplate?: string;
};

class ConfigurableHttpMarketDataAdapter implements MarketDataProviderAdapter {
  private readonly providerConfig: HttpProviderConfig;

  constructor(
    private readonly config: ConfigService,
    private readonly calendar: UsMarketCalendarService,
    private readonly provider: MarketDataProvider,
  ) {
    this.providerConfig = provider.configJson ? JSON.parse(provider.configJson) as HttpProviderConfig : {};
  }

  async dailyRange(symbol: string, startDate: string, endDate: string) {
    const path = (this.providerConfig.dailyPathTemplate ?? "/daily?symbol={symbol}&start={start}&end={end}")
      .replace("{symbol}", encodeURIComponent(symbol.toUpperCase()))
      .replace("{start}", encodeURIComponent(startDate))
      .replace("{end}", encodeURIComponent(endDate));
    const payload = await this.request(path);
    const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown[] }).data;
    if (!Array.isArray(rows)) throw new ServiceUnavailableException("在线行情响应缺少 data 数组");
    return rows.map((item) => normalizeHttpRow(item as Record<string, unknown>, symbol, this.provider.code));
  }

  async latestCompletedDaily(symbol: string, now = new Date()) {
    const session = this.calendar.latestCompletedSession(now);
    const rows = await this.dailyRange(symbol, session.date, session.date);
    return rows[0] ?? null;
  }

  async metadata(symbol: string) {
    if (!this.providerConfig.metadataPathTemplate) {
      return { currency: "USD", exchange: null, name: symbol.toUpperCase(), symbol: symbol.toUpperCase() };
    }
    const payload = await this.request(
      this.providerConfig.metadataPathTemplate.replace("{symbol}", encodeURIComponent(symbol.toUpperCase())),
    ) as Record<string, unknown>;
    return {
      currency: String(payload.currency ?? "USD"),
      exchange: payload.exchange ? String(payload.exchange) : null,
      name: String(payload.name ?? symbol.toUpperCase()),
      symbol: symbol.toUpperCase(),
    };
  }

  async corporateActions(symbol: string, startDate: string, endDate: string) {
    const rows = await this.dailyRange(symbol, startDate, endDate);
    return rows.flatMap<CorporateAction>((row) => {
      const date = row.tradeDate.toISOString().slice(0, 10);
      return [
        ...(row.dividend > 0 ? [{ amount: row.dividend, symbol: row.symbol, tradeDate: date, type: "DIVIDEND" as const }] : []),
        ...(row.splitFactor !== 1 ? [{ amount: row.splitFactor, symbol: row.symbol, tradeDate: date, type: "SPLIT" as const }] : []),
      ];
    });
  }

  async tradingCalendar(startDate: string, endDate: string) {
    return this.calendar.tradingDays(startDate, endDate);
  }

  async health(): Promise<ProviderHealth> {
    try {
      await this.request("/health");
      return {
        message: "在线行情 Provider 可用",
        ok: true,
        rateLimit: this.rateLimit(),
        version: this.provider.providerVersion ?? "http-json-v1",
      };
    } catch (error: unknown) {
      return {
        message: error instanceof Error ? error.message : "在线行情 Provider 不可用",
        ok: false,
        rateLimit: this.rateLimit(),
        version: this.provider.providerVersion ?? "http-json-v1",
      };
    }
  }

  private rateLimit() {
    const parsed = this.provider.rateLimitJson ? JSON.parse(this.provider.rateLimitJson) as { limit?: number } : {};
    return { limit: parsed.limit ?? null, remaining: null, resetsAt: null };
  }

  private async request(path: string): Promise<unknown> {
    const baseUrlEnv = this.providerConfig.baseUrlEnv ?? "MARKET_DATA_HTTP_BASE_URL";
    const baseUrl = this.config.get<string>(baseUrlEnv);
    if (!baseUrl) throw new ServiceUnavailableException(`${baseUrlEnv} 未配置，在线 Provider 保持禁用`);
    const apiKeyEnv = this.providerConfig.apiKeyEnv ?? "MARKET_DATA_HTTP_API_KEY";
    const apiKey = this.config.get<string>(apiKeyEnv);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(new URL(path, baseUrl), {
        headers: {
          Accept: "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new ServiceUnavailableException(`在线行情请求失败 (${response.status})`);
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeHttpRow(row: Record<string, unknown>, fallbackSymbol: string, source: string): NormalizedMarketRow {
  const tradeDate = utcDate(String(row.tradeDate ?? row.date ?? ""));
  return {
    adjustedClose: Number(row.adjustedClose ?? row.adjusted_close ?? row.close),
    close: Number(row.close),
    currency: String(row.currency ?? "USD"),
    dividend: Number(row.dividend ?? 0),
    high: Number(row.high),
    low: Number(row.low),
    open: Number(row.open),
    source,
    splitFactor: Number(row.splitFactor ?? row.split_factor ?? 1),
    symbol: String(row.symbol ?? fallbackSymbol).toUpperCase(),
    tradeDate,
    volume: Number(row.volume ?? 0),
  };
}

function utcDate(input: string) {
  const date = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new BadRequestException("日期格式必须为 YYYY-MM-DD");
  return date;
}
