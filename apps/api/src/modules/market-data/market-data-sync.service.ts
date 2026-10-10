import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";
import { MarketDataParserService } from "./market-data-parser.service";
import { MarketDataProviderRegistry } from "./market-data-provider";
import { UsMarketCalendarService } from "./us-market-calendar.service";

@Injectable()
export class MarketDataSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: MarketDataProviderRegistry,
    private readonly parser: MarketDataParserService,
    private readonly calendar: UsMarketCalendarService,
  ) {}

  async providerStatus() {
    const providers = await this.prisma.marketDataProvider.findMany({ orderBy: { code: "asc" } });
    return Promise.all(providers.map(async (provider) => {
      if (!["SEED", "HTTP_JSON"].includes(provider.providerType)) {
        return { ...provider, health: { message: "仅支持人工导入或尚未实现", ok: false, rateLimit: null, version: provider.providerVersion } };
      }
      const health = await this.providers.adapter(provider).health();
      await this.prisma.marketDataProvider.update({
        where: { id: provider.id },
        data: {
          lastHealthAt: new Date(),
          lastHealthMessage: health.message,
          lastHealthStatus: health.ok ? "HEALTHY" : "UNAVAILABLE",
        },
      });
      return { ...provider, health };
    }));
  }

  async sync(providerCode: string, symbols: string[], requestedDate?: string) {
    const provider = await this.prisma.marketDataProvider.findUnique({ where: { code: providerCode } });
    if (!provider) throw new NotFoundException("行情 Provider 不存在");
    if (!provider.enabled) throw new BadRequestException("行情 Provider 未启用");
    const adapter = this.providers.adapter(provider);
    const health = await adapter.health();
    if (!health.ok) throw new BadRequestException(`行情 Provider 不可用：${health.message}`);
    const session = requestedDate ? this.calendar.session(requestedDate) : this.calendar.latestCompletedSession();
    if (!session.isTradingDay) throw new BadRequestException(`${session.date} 不是美股交易日：${session.holidayName ?? "周末"}`);
    const normalizedSymbols = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
    if (normalizedSymbols.length === 0) throw new BadRequestException("没有需要同步的策略标的");

    const job = await this.prisma.marketDataSyncJob.create({
      data: {
        providerId: provider.id,
        startDate: new Date(`${session.date}T00:00:00.000Z`),
        endDate: new Date(`${session.date}T00:00:00.000Z`),
        status: "RUNNING",
        startedAt: new Date(),
        requestJson: JSON.stringify({ symbols: normalizedSymbols, timeZone: session.timeZone }),
      },
    });
    try {
      const rows = (await Promise.all(
        normalizedSymbols.map((symbol) => adapter.dailyRange(symbol, session.date, session.date)),
      )).flat();
      const errors = rows.flatMap((row) => this.parser.validate(row).map((message) => ({ message, symbol: row.symbol })));
      const returnedSymbols = new Set(rows.map((row) => row.symbol));
      for (const symbol of normalizedSymbols) {
        if (!returnedSymbols.has(symbol)) errors.push({ message: "Provider 未返回完整交易日日线", symbol });
      }
      if (errors.length > 0) throw new BadRequestException(JSON.stringify(errors));

      const result = await this.prisma.$transaction(async (transaction) => {
        let inserted = 0;
        let duplicates = 0;
        for (const row of rows) {
          const existing = await transaction.marketDataDaily.findUnique({
            where: { symbol_tradeDate_source: { source: provider.code, symbol: row.symbol, tradeDate: row.tradeDate } },
          });
          if (existing) {
            duplicates += 1;
            continue;
          }
          await transaction.marketDataDaily.create({ data: { ...row, providerId: provider.id } });
          inserted += 1;
        }
        await transaction.marketDataProvider.update({
          where: { id: provider.id },
          data: { lastHealthAt: new Date(), lastHealthMessage: health.message, lastHealthStatus: "HEALTHY", lastSyncAt: new Date() },
        });
        await transaction.marketDataSyncJob.update({
          where: { id: job.id },
          data: { status: "COMPLETED", finishedAt: new Date(), resultJson: JSON.stringify({ duplicates, inserted, received: rows.length }) },
        });
        return { duplicates, inserted, received: rows.length };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
      return { ...result, jobId: job.id, marketDate: session.date, providerCode, symbols: normalizedSymbols };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "行情同步失败";
      await this.prisma.marketDataSyncJob.update({ where: { id: job.id }, data: { status: "FAILED", errorMessage: message, finishedAt: new Date() } });
      throw error;
    }
  }
}
