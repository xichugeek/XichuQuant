import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import type { PreviewMarketDataDto } from "./market-data.dto";
import { markMarketDataDuplicates, marketDataKey } from "./market-data-dedup";
import { MarketDataParserService, type NormalizedMarketRow } from "./market-data-parser.service";

@Injectable()
export class MarketDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: MarketDataParserService,
  ) {}

  async providers() {
    return this.prisma.marketDataProvider.findMany({
      orderBy: [{ enabled: "desc" }, { code: "asc" }],
    });
  }

  async summary() {
    const [providers, groups, batches, jobs] = await Promise.all([
      this.providers(),
      this.prisma.marketDataDaily.groupBy({
        by: ["symbol", "source"],
        _count: { _all: true },
        _max: { tradeDate: true },
        _min: { tradeDate: true },
        orderBy: [{ symbol: "asc" }, { source: "asc" }],
      }),
      this.prisma.marketDataImportBatch.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      this.prisma.marketDataSyncJob.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    return {
      providers,
      series: groups.map((group) => ({
        count: group._count._all,
        endDate: group._max.tradeDate?.toISOString().slice(0, 10) ?? null,
        source: group.source,
        startDate: group._min.tradeDate?.toISOString().slice(0, 10) ?? null,
        symbol: group.symbol,
      })),
      importBatches: batches,
      syncJobs: jobs,
    };
  }

  async daily(symbol: string, source?: string, startDate?: string, endDate?: string) {
    const rows = await this.prisma.marketDataDaily.findMany({
      where: {
        symbol: symbol.toUpperCase(),
        source,
        tradeDate: {
          gte: startDate ? this.utcDate(startDate) : undefined,
          lte: endDate ? this.utcDate(endDate) : undefined,
        },
      },
      orderBy: { tradeDate: "asc" },
      take: 5000,
    });
    return rows.map((row) => ({
      ...row,
      adjustedClose: toNumber(row.adjustedClose),
      close: toNumber(row.close),
      dividend: toNumber(row.dividend),
      high: toNumber(row.high),
      low: toNumber(row.low),
      open: toNumber(row.open),
      splitFactor: toNumber(row.splitFactor),
      tradeDate: row.tradeDate.toISOString().slice(0, 10),
      volume: toNumber(row.volume),
    }));
  }

  async preview(dto: PreviewMarketDataDto) {
    const provider = await this.prisma.marketDataProvider.findUnique({
      where: { code: dto.providerCode ?? "CSV_IMPORT" },
    });
    if (!provider || !provider.enabled)
      throw new BadRequestException("行情 Provider 不存在或未启用");
    let parsed: ReturnType<MarketDataParserService["parse"]>;
    try {
      parsed = this.parser.parse(dto.content, dto.symbol, provider.code);
    } catch (error: unknown) {
      throw new BadRequestException(error instanceof Error ? error.message : "CSV 解析失败");
    }
    const validRows = parsed.records
      .map((record) => record.normalized)
      .filter((record): record is NormalizedMarketRow => record !== null);
    const symbols = [...new Set(validRows.map((row) => row.symbol))];
    const dates = validRows
      .map((row) => row.tradeDate)
      .filter((date) => !Number.isNaN(date.getTime()));
    const startDate = dates.length > 0 ? new Date(Math.min(...dates.map(Number))) : null;
    const endDate = dates.length > 0 ? new Date(Math.max(...dates.map(Number))) : null;
    const existing =
      startDate && endDate && symbols.length > 0
        ? await this.prisma.marketDataDaily.findMany({
            where: {
              symbol: { in: symbols },
              source: provider.code,
              tradeDate: { gte: startDate, lte: endDate },
            },
            select: { source: true, symbol: true, tradeDate: true },
          })
        : [];
    const existingKeys = new Set(existing.map((row) => marketDataKey(row)));
    const records = markMarketDataDuplicates(parsed.records, existingKeys);
    const missingDays = this.missingWeekdays(validRows);
    const fileHash = createHash("sha256").update(dto.content, "utf8").digest("hex");
    const batch = await this.prisma.$transaction(
      async (transaction) => {
        const created = await transaction.marketDataImportBatch.create({
          data: {
            providerId: provider.id,
            fileName: dto.fileName,
            fileHash,
            status: "PREVIEW",
            symbol: symbols.length === 1 ? symbols[0] : null,
            startDate,
            endDate,
            totalRecords: records.length,
            validRecords: records.filter((record) => record.status === "VALID").length,
            pendingRecords: records.filter((record) => record.status === "PENDING").length,
            duplicateRecords: records.filter((record) => record.status === "DUPLICATE").length,
            missingDaysJson: JSON.stringify(missingDays),
            mappingJson: JSON.stringify(parsed.mapping),
          },
        });
        if (records.length > 0) {
          await transaction.marketDataImportRecord.createMany({
            data: records.map((record) => ({
              batchId: created.id,
              sourceRow: record.sourceRow,
              status: record.status,
              symbol: record.normalized?.symbol,
              tradeDate:
                record.normalized && !Number.isNaN(record.normalized.tradeDate.getTime())
                  ? record.normalized.tradeDate
                  : null,
              normalizedData: JSON.stringify(record.normalized),
              rawData: JSON.stringify(record.raw),
              validationErrors: record.errors.length > 0 ? JSON.stringify(record.errors) : null,
            })),
          });
        }
        return created;
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
    return this.batch(batch.id);
  }

  async confirm(batchId: string) {
    const batch = await this.prisma.marketDataImportBatch.findUnique({
      where: { id: batchId },
      include: {
        provider: true,
        records: { where: { status: "VALID" }, orderBy: { sourceRow: "asc" } },
      },
    });
    if (!batch) throw new NotFoundException("行情导入批次不存在");
    if (batch.status !== "PREVIEW") throw new BadRequestException("只有预览批次可以确认导入");
    if (batch.validRecords === 0) throw new BadRequestException("没有可导入的有效行情");
    try {
      await this.prisma.$transaction(
        async (transaction) => {
          const rows = batch.records.map(
            (record) =>
              JSON.parse(record.normalizedData) as Omit<NormalizedMarketRow, "tradeDate"> & {
                tradeDate: string;
              },
          );
          for (let index = 0; index < rows.length; index += 75) {
            await transaction.marketDataDaily.createMany({
              data: rows.slice(index, index + 75).map((row) => ({
                ...row,
                providerId: batch.providerId,
                tradeDate: new Date(row.tradeDate),
              })),
            });
          }
          await transaction.marketDataImportRecord.updateMany({
            where: { batchId, status: "VALID" },
            data: { status: "IMPORTED" },
          });
          await transaction.marketDataImportBatch.update({
            where: { id: batchId },
            data: {
              status: "COMPLETED",
              importedRecords: batch.validRecords,
              confirmedAt: new Date(),
              resultJson: JSON.stringify({
                imported: batch.validRecords,
                pending: batch.pendingRecords,
                duplicates: batch.duplicateRecords,
              }),
            },
          });
        },
        { maxWait: 10_000, timeout: 120_000 },
      );
    } catch (error: unknown) {
      await this.prisma.marketDataImportBatch.update({
        where: { id: batchId },
        data: {
          status: "FAILED",
          errorMessage: error instanceof Error ? error.message : "写库失败",
        },
      });
      throw new BadRequestException("行情导入失败，事务已经回滚");
    }
    return this.batch(batchId);
  }

  async batch(batchId: string) {
    const batch = await this.prisma.marketDataImportBatch.findUnique({
      where: { id: batchId },
      include: { provider: true, records: { orderBy: { sourceRow: "asc" }, take: 500 } },
    });
    if (!batch) throw new NotFoundException("行情导入批次不存在");
    return {
      ...batch,
      mapping: batch.mappingJson ? JSON.parse(batch.mappingJson) : {},
      missingDays: batch.missingDaysJson ? JSON.parse(batch.missingDaysJson) : [],
      records: batch.records.map((record) => ({
        ...record,
        errors: record.validationErrors ? JSON.parse(record.validationErrors) : [],
        normalized: JSON.parse(record.normalizedData),
        raw: JSON.parse(record.rawData),
      })),
    };
  }

  private missingWeekdays(rows: NormalizedMarketRow[]) {
    const missing: Array<{ date: string; symbol: string }> = [];
    for (const symbol of new Set(rows.map((row) => row.symbol))) {
      const symbolDates = rows.filter((row) => row.symbol === symbol).map((row) => row.tradeDate);
      if (symbolDates.length < 2) continue;
      const existing = new Set(symbolDates.map((date) => date.toISOString().slice(0, 10)));
      const cursor = new Date(Math.min(...symbolDates.map(Number)));
      const end = new Date(Math.max(...symbolDates.map(Number)));
      while (cursor <= end && missing.length < 200) {
        if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
          const date = cursor.toISOString().slice(0, 10);
          if (!existing.has(date)) missing.push({ date, symbol });
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    return missing;
  }

  private utcDate(input: string) {
    const date = new Date(`${input}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException("日期格式必须为 YYYY-MM-DD");
    return date;
  }
}
