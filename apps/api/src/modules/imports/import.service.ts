import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type ImportBatch, type ImportRecord } from "@prisma/client";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import { RiskService } from "../risk/risk.service";
import type { ResolveImportRecordDto, PreviewImportDto } from "./import.dto";
import type {
  AccountingPosition,
  ImportRecordStatus,
  ImportRollbackData,
  NormalizedImportRecord,
  PositionState,
} from "./import.types";
import { IbkrCsvParserService, validateNormalizedRecord } from "./parser/ibkr-csv-parser.service";
import { applySplitToPosition, applyTradesToPositions, cashImpact } from "./portfolio-accounting";

type PreviewEntry = {
  normalized: NormalizedImportRecord;
  status: ImportRecordStatus;
  errors: string[];
};

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: IbkrCsvParserService,
    private readonly riskService: RiskService,
  ) {}

  async findAll(accountId?: string) {
    const batches = await this.prisma.importBatch.findMany({
      where: accountId ? { accountId } : undefined,
      include: { account: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return batches.map((batch) => ({
      ...this.batchFields(batch),
      accountName: batch.account.name,
    }));
  }

  async findOne(id: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id },
      include: {
        account: { select: { name: true, baseCurrency: true, brokerAccountId: true } },
        records: { orderBy: [{ sourceRow: "asc" }, { createdAt: "asc" }] },
      },
    });
    if (!batch) throw new NotFoundException("导入批次不存在");
    return {
      ...this.batchFields(batch),
      accountName: batch.account.name,
      baseCurrency: batch.account.baseCurrency,
      brokerAccountId: batch.account.brokerAccountId,
      records: batch.records.map((record) => this.recordFields(record)),
    };
  }

  async preview(dto: PreviewImportDto) {
    if (!dto.fileName.toLowerCase().endsWith(".csv")) {
      throw new BadRequestException("当前仅支持 IBKR Activity Statement CSV 文件");
    }
    const account = await this.prisma.account.findUnique({ where: { id: dto.accountId } });
    if (!account) throw new NotFoundException("账户不存在");
    const parsed = this.parser.parse(dto.content);
    const matchStatus = accountMatchStatus(account.brokerAccountId, parsed.externalAccountIds);
    const matchError =
      matchStatus === "MISMATCH"
        ? `文件账户 ${parsed.externalAccountIds[0]} 与当前绑定账户 ${account.brokerAccountId} 不一致`
        : matchStatus === "MULTIPLE"
          ? "文件包含多个 IBKR 账户，必须拆分后分别导入"
          : null;

    const appliedKeys = new Set<string>();
    const requestedKeys = parsed.records.map((record) => appliedKey(account.id, record.externalId));
    for (const keyChunk of chunks(requestedKeys, 500)) {
      const existing = await this.prisma.importRecord.findMany({
        where: { dedupKey: { in: keyChunk } },
        select: { dedupKey: true },
      });
      existing.forEach((record) => appliedKeys.add(record.dedupKey));
    }

    const seenInFile = new Set<string>();
    const entries: PreviewEntry[] = parsed.records.map((record) => {
      const errors = [...record.validationErrors];
      if (matchError) errors.push(matchError);
      if (
        record.currency !== account.baseCurrency &&
        record.fxRateToBase === null &&
        record.recordType !== "UNKNOWN"
      ) {
        errors.push(
          `${record.currency} 记录缺少 FX Rate to Base，不能可靠折算为 ${account.baseCurrency}`,
        );
      }
      const key = appliedKey(account.id, record.externalId);
      const duplicate = appliedKeys.has(key) || seenInFile.has(record.externalId);
      seenInFile.add(record.externalId);
      const status: ImportRecordStatus = duplicate
        ? "DUPLICATE"
        : errors.length > 0
          ? "PENDING"
          : "VALID";
      return { normalized: { ...record, validationErrors: errors }, status, errors };
    });

    const counts = countStatuses(entries.map((entry) => entry.status));
    const batchId = randomUUID();
    const resultJson = JSON.stringify({
      adapter: parsed.adapter,
      ignoredRows: parsed.ignoredRows,
      matchStatus,
      externalAccountIds: parsed.externalAccountIds,
      message: accountMatchMessage(matchStatus, parsed.externalAccountIds, account.name),
    });

    await this.prisma.$transaction(async (transaction) => {
      await transaction.importBatch.create({
        data: {
          id: batchId,
          accountId: account.id,
          fileName: dto.fileName,
          fileHash: parsed.fileHash,
          status: "PREVIEW",
          statementAccountId: parsed.externalAccountIds.join(", ") || null,
          statementStart: parsed.statementStart ? new Date(parsed.statementStart) : null,
          statementEnd: parsed.statementEnd ? new Date(parsed.statementEnd) : null,
          totalRecords: entries.length,
          validRecords: counts.VALID,
          pendingRecords: counts.PENDING,
          duplicateRecords: counts.DUPLICATE,
          resultJson,
        },
      });
      const rows = entries.map((entry, index) => ({
        id: randomUUID(),
        batchId,
        accountId: account.id,
        sourceSection: entry.normalized.sourceSection,
        sourceRow: entry.normalized.sourceRow,
        recordType: entry.normalized.recordType,
        status: entry.status,
        externalId: entry.normalized.externalId,
        dedupKey: stagedKey(batchId, index, entry.normalized.externalId),
        externalAccountId: entry.normalized.externalAccountId,
        transactionDate: entry.normalized.transactionDate
          ? new Date(entry.normalized.transactionDate)
          : null,
        symbol: entry.normalized.symbol,
        currency: entry.normalized.currency,
        action: entry.normalized.action,
        quantity: entry.normalized.quantity,
        price: entry.normalized.price,
        amount: entry.normalized.amount,
        commission: entry.normalized.commission,
        realizedPnl: entry.normalized.realizedPnl,
        rawData: JSON.stringify(entry.normalized.raw),
        normalizedData: JSON.stringify(entry.normalized),
        validationErrors: entry.errors.length > 0 ? JSON.stringify(entry.errors) : null,
      }));
      for (const rowChunk of chunks(rows, 40)) {
        await transaction.importRecord.createMany({ data: rowChunk });
      }
    });

    return this.findOne(batchId);
  }

  async resolveRecord(batchId: string, recordId: string, dto: ResolveImportRecordDto) {
    const record = await this.prisma.importRecord.findFirst({
      where: { id: recordId, batchId },
      include: { batch: { include: { account: true } } },
    });
    if (!record) throw new NotFoundException("待确认记录不存在");
    if (!["PREVIEW", "FAILED"].includes(record.batch.status)) {
      throw new ConflictException("只有尚未确认的批次可以修正记录");
    }
    if (record.status === "DUPLICATE") throw new ConflictException("重复记录不需要人工修正");

    const normalized = JSON.parse(record.normalizedData) as NormalizedImportRecord;
    const corrected = recalculateResolvedRecord({ ...normalized, ...dto });
    const errors = validateNormalizedRecord(corrected);
    if (
      corrected.currency !== record.batch.account.baseCurrency &&
      corrected.fxRateToBase === null &&
      corrected.recordType !== "UNKNOWN"
    ) {
      errors.push(
        `${corrected.currency} 记录缺少 FX Rate to Base，不能可靠折算为 ${record.batch.account.baseCurrency}`,
      );
    }
    corrected.validationErrors = errors;
    await this.prisma.importRecord.update({
      where: { id: record.id },
      data: {
        recordType: corrected.recordType,
        status: errors.length === 0 ? "VALID" : "PENDING",
        transactionDate: corrected.transactionDate ? new Date(corrected.transactionDate) : null,
        symbol: corrected.symbol,
        currency: corrected.currency,
        action: corrected.action,
        quantity: corrected.quantity,
        price: corrected.price,
        amount: corrected.amount,
        commission: corrected.commission,
        realizedPnl: corrected.realizedPnl,
        normalizedData: JSON.stringify(corrected),
        validationErrors: errors.length > 0 ? JSON.stringify(errors) : null,
        resolutionNote: dto.resolutionNote,
      },
    });
    await this.recountBatch(batchId);
    return this.findOne(batchId);
  }

  async confirm(batchId: string) {
    const existing = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { records: true },
    });
    if (!existing) throw new NotFoundException("导入批次不存在");
    if (!["PREVIEW", "FAILED"].includes(existing.status)) {
      throw new ConflictException("该批次已经确认或撤销");
    }
    if (existing.records.some((record) => record.status === "PENDING")) {
      throw new BadRequestException("仍有待确认记录，请修正后再确认导入");
    }

    try {
      await this.prisma.$transaction(
        async (transaction) => this.confirmInTransaction(transaction, batchId),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 60_000,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入失败";
      await this.prisma.importBatch.updateMany({
        where: { id: batchId, status: { not: "COMPLETED" } },
        data: { status: "FAILED", errorMessage: message, failedRecords: 1 },
      });
      throw error;
    }
    return this.findOne(batchId);
  }

  async rollback(batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException("导入批次不存在");
    if (batch.status !== "COMPLETED") throw new ConflictException("只有已完成批次可以撤销");
    if (batch.importedRecords === 0) {
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: { status: "ROLLED_BACK", rolledBackAt: new Date() },
      });
      return this.findOne(batchId);
    }
    const latest = await this.prisma.importBatch.findFirst({
      where: { accountId: batch.accountId, status: "COMPLETED", importedRecords: { gt: 0 } },
      orderBy: { confirmedAt: "desc" },
    });
    if (latest?.id !== batch.id) {
      throw new ConflictException("为保证账务一致性，请先撤销该账户最新的导入批次");
    }
    if (!batch.rollbackData) throw new ConflictException("该批次缺少回滚快照，禁止撤销");
    const rollbackData = JSON.parse(batch.rollbackData) as ImportRollbackData;

    await this.prisma.$transaction(
      async (transaction) => {
        await transaction.trade.deleteMany({ where: { importBatchId: batch.id } });
        const snapshotDate = new Date(rollbackData.snapshotDate);
        if (rollbackData.snapshot) {
          await transaction.accountEquitySnapshot.upsert({
            where: { accountId_snapshotDate: { accountId: batch.accountId, snapshotDate } },
            update: {
              totalEquity: rollbackData.snapshot.totalEquity,
              cashBalance: rollbackData.snapshot.cashBalance,
              realizedPnlYtd: rollbackData.snapshot.realizedPnlYtd,
              note: rollbackData.snapshot.note,
              importBatchId: rollbackData.snapshot.importBatchId,
            },
            create: {
              id: rollbackData.snapshot.id,
              accountId: batch.accountId,
              snapshotDate,
              totalEquity: rollbackData.snapshot.totalEquity,
              cashBalance: rollbackData.snapshot.cashBalance,
              realizedPnlYtd: rollbackData.snapshot.realizedPnlYtd,
              note: rollbackData.snapshot.note,
              importBatchId: rollbackData.snapshot.importBatchId,
            },
          });
        } else {
          await transaction.accountEquitySnapshot.deleteMany({
            where: { accountId: batch.accountId, snapshotDate, importBatchId: batch.id },
          });
        }

        for (const affected of rollbackData.affectedPositions) {
          if (!affected.before) {
            await transaction.position.deleteMany({
              where: { accountId: batch.accountId, instrumentId: affected.instrumentId },
            });
          } else {
            await transaction.position.upsert({
              where: {
                accountId_instrumentId: {
                  accountId: batch.accountId,
                  instrumentId: affected.instrumentId,
                },
              },
              update: {
                quantity: affected.before.quantity,
                avgCost: affected.before.avgCost,
                currentPrice: affected.before.currentPrice,
                note: affected.before.note,
              },
              create: {
                accountId: batch.accountId,
                instrumentId: affected.instrumentId,
                quantity: affected.before.quantity,
                avgCost: affected.before.avgCost,
                currentPrice: affected.before.currentPrice,
                note: affected.before.note,
              },
            });
          }
        }

        await transaction.account.update({
          where: { id: batch.accountId },
          data: rollbackData.account,
        });
        const records = await transaction.importRecord.findMany({ where: { batchId: batch.id } });
        for (const record of records) {
          await transaction.importRecord.update({
            where: { id: record.id },
            data: {
              status: "ROLLED_BACK",
              dedupKey: `ROLLED_BACK:${batch.id}:${record.sourceRow}:${record.id}`.slice(0, 200),
              relatedEntityId: null,
              relatedEntityType: null,
            },
          });
        }
        await transaction.importBatch.update({
          where: { id: batch.id },
          data: { status: "ROLLED_BACK", rolledBackAt: new Date() },
        });
        for (const instrumentId of rollbackData.createdInstrumentIds) {
          const [positionCount, tradeCount] = await Promise.all([
            transaction.position.count({ where: { instrumentId } }),
            transaction.trade.count({ where: { instrumentId } }),
          ]);
          if (positionCount === 0 && tradeCount === 0) {
            await transaction.instrument.deleteMany({ where: { id: instrumentId } });
          }
        }
        await this.riskService.evaluateAndPersistInTransaction(transaction, batch.accountId);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      },
    );
    return this.findOne(batchId);
  }

  private async confirmInTransaction(transaction: Prisma.TransactionClient, batchId: string) {
    const batch = await transaction.importBatch.findUnique({
      where: { id: batchId },
      include: { account: true, records: { orderBy: { sourceRow: "asc" } } },
    });
    if (!batch || !["PREVIEW", "FAILED"].includes(batch.status)) {
      throw new ConflictException("导入批次状态已发生变化，请刷新页面");
    }
    if (batch.records.some((record) => record.status === "PENDING")) {
      throw new BadRequestException("仍有待确认记录，请修正后再确认导入");
    }
    const externalAccountIds = [
      ...new Set(batch.records.map((record) => record.externalAccountId).filter(Boolean)),
    ];
    const matchStatus = accountMatchStatus(
      batch.account.brokerAccountId,
      externalAccountIds as string[],
    );
    if (matchStatus === "MISMATCH" || matchStatus === "MULTIPLE") {
      throw new BadRequestException("IBKR 文件账户与系统账户不匹配");
    }

    await transaction.importBatch.update({
      where: { id: batch.id },
      data: { status: "IMPORTING", errorMessage: null, failedRecords: 0 },
    });
    const validRecords = batch.records.filter((record) => record.status === "VALID");
    const desiredKeys = validRecords.map((record) =>
      appliedKey(batch.accountId, record.externalId),
    );
    const existingKeys = new Set<string>();
    for (const keyChunk of chunks(desiredKeys, 500)) {
      const existing = await transaction.importRecord.findMany({
        where: { dedupKey: { in: keyChunk } },
        select: { dedupKey: true },
      });
      existing.forEach((record) => existingKeys.add(record.dedupKey));
    }
    const effectiveRecords = validRecords.filter(
      (record) => !existingKeys.has(appliedKey(batch.accountId, record.externalId)),
    );
    const concurrentDuplicates = validRecords.filter(
      (record) => !effectiveRecords.includes(record),
    );
    if (concurrentDuplicates.length > 0) {
      await transaction.importRecord.updateMany({
        where: { id: { in: concurrentDuplicates.map((record) => record.id) } },
        data: { status: "DUPLICATE" },
      });
    }
    const duplicateRecords =
      batch.records.filter((record) => record.status === "DUPLICATE").length +
      concurrentDuplicates.length;
    if (effectiveRecords.length === 0) {
      await transaction.importBatch.update({
        where: { id: batch.id },
        data: {
          status: "COMPLETED",
          confirmedAt: new Date(),
          importedRecords: 0,
          duplicateRecords,
          resultJson: mergeResultJson(batch.resultJson, {
            importedRecords: 0,
            duplicateRecords,
            message: "文件中的记录均已导入，本次未重复记账。",
          }),
        },
      });
      return;
    }

    const normalizedEntries = effectiveRecords.map((record) => ({
      db: record,
      value: JSON.parse(record.normalizedData) as NormalizedImportRecord,
    }));
    const existingPositions = await transaction.position.findMany({
      where: { accountId: batch.accountId },
      include: { instrument: true },
    });
    const instrumentBySymbol = new Map(
      existingPositions.map((position) => [position.instrument.symbol, position.instrument]),
    );
    const createdInstrumentIds: string[] = [];
    for (const entry of normalizedEntries) {
      const symbol = entry.value.symbol;
      if (!symbol || instrumentBySymbol.has(symbol)) continue;
      const existing = await transaction.instrument.findUnique({ where: { symbol } });
      if (existing) {
        instrumentBySymbol.set(symbol, existing);
        continue;
      }
      const instrument = await transaction.instrument.create({
        data: {
          symbol,
          name: entry.value.description ?? symbol,
          market: "IBKR",
          assetType: inferAssetType(entry.value),
          category: "IMPORTED",
          theme: null,
          note: `由 IBKR 导入批次 ${batch.id} 创建`,
        },
      });
      instrumentBySymbol.set(symbol, instrument);
      createdInstrumentIds.push(instrument.id);
    }

    const affectedSymbols = new Set(
      normalizedEntries
        .filter((entry) =>
          ["TRADE", "POSITION", "CORPORATE_ACTION"].includes(entry.value.recordType),
        )
        .map((entry) => entry.value.symbol)
        .filter((symbol): symbol is string => Boolean(symbol)),
    );
    const beforeBySymbol = new Map(
      existingPositions.map((position) => [
        position.instrument.symbol,
        {
          instrumentId: position.instrumentId,
          symbol: position.instrument.symbol,
          quantity: toNumber(position.quantity),
          avgCost: toNumber(position.avgCost),
          currentPrice: toNumber(position.currentPrice),
          note: position.note,
        } satisfies PositionState,
      ]),
    );
    const affectedPositions = [...affectedSymbols].map((symbol) => ({
      instrumentId: instrumentBySymbol.get(symbol)!.id,
      before: beforeBySymbol.get(symbol) ?? null,
    }));

    const authoritative = new Map<string, NormalizedImportRecord>();
    for (const entry of normalizedEntries.filter((item) => item.value.recordType === "POSITION")) {
      if (entry.value.symbol) authoritative.set(entry.value.symbol, entry.value);
    }
    const accountingInitial: AccountingPosition[] = existingPositions.map((position) => ({
      symbol: position.instrument.symbol,
      quantity: toNumber(position.quantity),
      avgCost: toNumber(position.avgCost),
      currentPrice: toNumber(position.currentPrice),
    }));
    const tradeEntries = normalizedEntries.filter(
      (entry) =>
        entry.value.recordType === "TRADE" &&
        entry.value.symbol &&
        !authoritative.has(entry.value.symbol),
    );
    const tradeCalculation = applyTradesToPositions(
      accountingInitial,
      tradeEntries.map((entry) => ({
        symbol: entry.value.symbol!,
        side: entry.value.action as "BUY" | "SELL",
        quantity: entry.value.quantity!,
        price: entry.value.price!,
        commission: entry.value.commission ?? 0,
        realizedPnl: entry.value.realizedPnl,
      })),
    );
    const nextPositions = new Map(
      tradeCalculation.positions.map((position) => [position.symbol, position]),
    );

    for (const [symbol, position] of authoritative) {
      nextPositions.set(symbol, authoritativePosition(position, batch.account.baseCurrency));
    }
    for (const entry of normalizedEntries.filter(
      (item) =>
        item.value.recordType === "CORPORATE_ACTION" &&
        item.value.symbol &&
        !authoritative.has(item.value.symbol),
    )) {
      const current = nextPositions.get(entry.value.symbol!);
      if (!current || entry.value.splitRatio === null) {
        throw new BadRequestException(`${entry.value.symbol} 股票拆分缺少可应用的持仓或比例`);
      }
      nextPositions.set(entry.value.symbol!, applySplitToPosition(current, entry.value.splitRatio));
    }

    for (const symbol of affectedSymbols) {
      const instrument = instrumentBySymbol.get(symbol)!;
      const next = nextPositions.get(symbol);
      if (!next || Math.abs(next.quantity) < 1e-8) {
        await transaction.position.deleteMany({
          where: { accountId: batch.accountId, instrumentId: instrument.id },
        });
      } else {
        await transaction.position.upsert({
          where: {
            accountId_instrumentId: { accountId: batch.accountId, instrumentId: instrument.id },
          },
          update: {
            quantity: next.quantity,
            avgCost: next.avgCost,
            currentPrice: next.currentPrice,
            note: `IBKR 批次 ${batch.id} 重算`,
          },
          create: {
            accountId: batch.accountId,
            instrumentId: instrument.id,
            quantity: next.quantity,
            avgCost: next.avgCost,
            currentPrice: next.currentPrice,
            note: `IBKR 批次 ${batch.id} 创建`,
          },
        });
      }
    }

    const tradeEntityIds = new Map<string, string>();
    for (const entry of normalizedEntries.filter((item) => item.value.recordType === "TRADE")) {
      const value = entry.value;
      const instrument = instrumentBySymbol.get(value.symbol!)!;
      const trade = await transaction.trade.create({
        data: {
          accountId: batch.accountId,
          instrumentId: instrument.id,
          tradeDate: new Date(value.transactionDate!),
          side: value.action!,
          quantity: value.quantity!,
          price: value.price!,
          commission: value.commission ?? 0,
          amount: value.amount ?? value.quantity! * value.price!,
          realizedPnl: value.realizedPnl,
          currency: value.currency,
          externalId: value.externalId,
          importBatchId: batch.id,
          reason: "IBKR Activity Statement CSV 导入",
          isRuleFollowed: null,
          note: value.description,
        },
      });
      tradeEntityIds.set(entry.db.id, trade.id);
    }

    const cashBalanceRecords = normalizedEntries
      .map((entry) => entry.value)
      .filter((record) => record.recordType === "CASH_BALANCE" && record.amount !== null);
    let cashBalance: number;
    const baseCash = cashBalanceRecords.filter(
      (record) => record.currency === batch.account.baseCurrency,
    );
    if (baseCash.length > 0) {
      cashBalance = baseCash.at(-1)!.amount!;
    } else if (cashBalanceRecords.length > 0) {
      cashBalance = cashBalanceRecords.reduce(
        (sum, record) => sum + record.amount! * (record.fxRateToBase ?? 1),
        0,
      );
    } else {
      cashBalance =
        toNumber(batch.account.cashBalance) +
        normalizedEntries.reduce(
          (sum, entry) => sum + cashImpact(entry.value, batch.account.baseCurrency),
          0,
        );
    }
    const currentYear = new Date().getUTCFullYear();
    const authoritativeRealized = normalizedEntries
      .map((entry) => entry.value)
      .filter(
        (record) =>
          record.realizedPnl !== null &&
          record.transactionDate !== null &&
          new Date(record.transactionDate).getUTCFullYear() === currentYear &&
          (record.recordType !== "TRADE" || (record.symbol && authoritative.has(record.symbol))),
      )
      .reduce((sum, record) => sum + record.realizedPnl!, 0);
    const realizedPnlYtd =
      toNumber(batch.account.realizedPnlYtd) +
      tradeCalculation.calculatedRealizedPnl +
      authoritativeRealized;
    const persistedPositions = await transaction.position.findMany({
      where: { accountId: batch.accountId },
    });
    const calculatedEquity =
      cashBalance +
      persistedPositions.reduce(
        (sum, position) => sum + toNumber(position.quantity) * toNumber(position.currentPrice),
        0,
      );
    const navRecord = normalizedEntries
      .map((entry) => entry.value)
      .filter(
        (record) =>
          record.recordType === "NAV_SNAPSHOT" &&
          record.amount !== null &&
          record.currency === batch.account.baseCurrency,
      )
      .at(-1);
    const totalEquity = navRecord?.amount ?? calculatedEquity;
    const snapshotDate = normalizeSnapshotDate(
      batch.statementEnd ??
        latestRecordDate(normalizedEntries.map((entry) => entry.value)) ??
        new Date(),
    );
    const previousSnapshot = await transaction.accountEquitySnapshot.findUnique({
      where: { accountId_snapshotDate: { accountId: batch.accountId, snapshotDate } },
    });
    const rollbackData: ImportRollbackData = {
      account: {
        initialCapital: toNumber(batch.account.initialCapital),
        totalEquity: toNumber(batch.account.totalEquity),
        cashBalance: toNumber(batch.account.cashBalance),
        realizedPnlYtd: toNumber(batch.account.realizedPnlYtd),
        brokerAccountId: batch.account.brokerAccountId,
      },
      affectedPositions,
      createdInstrumentIds,
      snapshot: previousSnapshot
        ? {
            id: previousSnapshot.id,
            snapshotDate: previousSnapshot.snapshotDate.toISOString(),
            totalEquity: toNumber(previousSnapshot.totalEquity),
            cashBalance: toNumber(previousSnapshot.cashBalance),
            realizedPnlYtd: toNumber(previousSnapshot.realizedPnlYtd),
            note: previousSnapshot.note,
            importBatchId: previousSnapshot.importBatchId,
          }
        : null,
      snapshotDate: snapshotDate.toISOString(),
    };

    await transaction.account.update({
      where: { id: batch.accountId },
      data: {
        brokerAccountId:
          batch.account.brokerAccountId ??
          (externalAccountIds.length === 1 ? externalAccountIds[0] : null),
        cashBalance,
        realizedPnlYtd,
        totalEquity,
      },
    });
    await transaction.accountEquitySnapshot.upsert({
      where: { accountId_snapshotDate: { accountId: batch.accountId, snapshotDate } },
      update: {
        totalEquity,
        cashBalance,
        realizedPnlYtd,
        note: `IBKR 导入批次 ${batch.id}`,
        importBatchId: batch.id,
      },
      create: {
        accountId: batch.accountId,
        snapshotDate,
        totalEquity,
        cashBalance,
        realizedPnlYtd,
        note: `IBKR 导入批次 ${batch.id}`,
        importBatchId: batch.id,
      },
    });

    for (const entry of normalizedEntries) {
      const tradeId = tradeEntityIds.get(entry.db.id);
      await transaction.importRecord.update({
        where: { id: entry.db.id },
        data: {
          status: "IMPORTED",
          dedupKey: appliedKey(batch.accountId, entry.value.externalId),
          relatedEntityType: tradeId
            ? "TRADE"
            : entry.value.recordType === "POSITION"
              ? "POSITION"
              : "ACCOUNT",
          relatedEntityId:
            tradeId ??
            (entry.value.symbol
              ? instrumentBySymbol.get(entry.value.symbol)?.id
              : batch.accountId) ??
            batch.accountId,
        },
      });
    }
    const risk = await this.riskService.evaluateAndPersistInTransaction(
      transaction,
      batch.accountId,
    );
    await transaction.importBatch.update({
      where: { id: batch.id },
      data: {
        status: "COMPLETED",
        confirmedAt: new Date(),
        importedRecords: effectiveRecords.length,
        duplicateRecords,
        rollbackData: JSON.stringify(rollbackData),
        resultJson: mergeResultJson(batch.resultJson, {
          importedRecords: effectiveRecords.length,
          duplicateRecords,
          totalEquity,
          cashBalance,
          realizedPnlYtd,
          positionCount: persistedPositions.length,
          riskLevel: risk.overallRiskLevel,
          riskAlertCount: risk.alerts.length,
          message: "导入成功，账户、持仓、权益快照和风控报警已重新计算。",
        }),
      },
    });
  }

  private async recountBatch(batchId: string) {
    const records = await this.prisma.importRecord.findMany({
      where: { batchId },
      select: { status: true },
    });
    const counts = countStatuses(records.map((record) => record.status as ImportRecordStatus));
    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: {
        validRecords: counts.VALID,
        pendingRecords: counts.PENDING,
        duplicateRecords: counts.DUPLICATE,
        status: "PREVIEW",
        errorMessage: null,
      },
    });
  }

  private batchFields(batch: ImportBatch) {
    return {
      id: batch.id,
      accountId: batch.accountId,
      source: batch.source,
      fileName: batch.fileName,
      fileHash: batch.fileHash,
      status: batch.status,
      statementAccountId: batch.statementAccountId,
      statementStart: batch.statementStart?.toISOString() ?? null,
      statementEnd: batch.statementEnd?.toISOString() ?? null,
      totalRecords: batch.totalRecords,
      validRecords: batch.validRecords,
      pendingRecords: batch.pendingRecords,
      duplicateRecords: batch.duplicateRecords,
      importedRecords: batch.importedRecords,
      failedRecords: batch.failedRecords,
      result: parseJsonObject(batch.resultJson),
      errorMessage: batch.errorMessage,
      confirmedAt: batch.confirmedAt?.toISOString() ?? null,
      rolledBackAt: batch.rolledBackAt?.toISOString() ?? null,
      createdAt: batch.createdAt.toISOString(),
      updatedAt: batch.updatedAt.toISOString(),
    };
  }

  private recordFields(record: ImportRecord) {
    return {
      id: record.id,
      batchId: record.batchId,
      sourceSection: record.sourceSection,
      sourceRow: record.sourceRow,
      recordType: record.recordType,
      status: record.status,
      externalId: record.externalId,
      externalAccountId: record.externalAccountId,
      transactionDate: record.transactionDate?.toISOString() ?? null,
      symbol: record.symbol,
      currency: record.currency,
      action: record.action,
      quantity: record.quantity === null ? null : toNumber(record.quantity),
      price: record.price === null ? null : toNumber(record.price),
      amount: record.amount === null ? null : toNumber(record.amount),
      commission: record.commission === null ? null : toNumber(record.commission),
      realizedPnl: record.realizedPnl === null ? null : toNumber(record.realizedPnl),
      normalized: JSON.parse(record.normalizedData) as NormalizedImportRecord,
      validationErrors: parseJsonArray(record.validationErrors),
      resolutionNote: record.resolutionNote,
      relatedEntityType: record.relatedEntityType,
      relatedEntityId: record.relatedEntityId,
    };
  }
}

function accountMatchStatus(
  brokerAccountId: string | null,
  externalAccountIds: string[],
): "EXACT" | "UNBOUND" | "MISSING" | "MISMATCH" | "MULTIPLE" {
  if (externalAccountIds.length > 1) return "MULTIPLE";
  if (externalAccountIds.length === 0) return "MISSING";
  if (!brokerAccountId) return "UNBOUND";
  return brokerAccountId === externalAccountIds[0] ? "EXACT" : "MISMATCH";
}

function accountMatchMessage(
  status: ReturnType<typeof accountMatchStatus>,
  accountIds: string[],
  accountName: string,
): string {
  const external = accountIds[0] ?? "未提供账户号";
  const messages = {
    EXACT: `IBKR 账户 ${external} 已匹配 ${accountName}`,
    UNBOUND: `IBKR 账户 ${external} 将在确认导入时绑定到 ${accountName}`,
    MISSING: `文件未包含 IBKR 账户号，将使用用户选择的 ${accountName}`,
    MISMATCH: `IBKR 账户 ${external} 与 ${accountName} 的已绑定账户不一致`,
    MULTIPLE: "文件包含多个 IBKR 账户，请拆分文件后导入",
  };
  return messages[status];
}

function countStatuses(statuses: ImportRecordStatus[]) {
  const counts: Record<ImportRecordStatus, number> = {
    VALID: 0,
    PENDING: 0,
    DUPLICATE: 0,
    IMPORTED: 0,
    FAILED: 0,
    ROLLED_BACK: 0,
  };
  statuses.forEach((status) => {
    counts[status] += 1;
  });
  return counts;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

function appliedKey(accountId: string, externalId: string): string {
  return `APPLIED:${accountId}:${externalId}`.slice(0, 200);
}

function stagedKey(batchId: string, index: number, externalId: string): string {
  return `STAGED:${batchId}:${index}:${externalId.slice(-32)}`.slice(0, 200);
}

function mergeResultJson(value: string | null, additions: Record<string, unknown>): string {
  return JSON.stringify({ ...parseJsonObject(value), ...additions });
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    return [value];
  }
}

function recalculateResolvedRecord(record: NormalizedImportRecord): NormalizedImportRecord {
  const corrected = {
    ...record,
    symbol: record.symbol?.trim().toUpperCase() || null,
    currency: record.currency.trim().toUpperCase() || "USD",
    action: record.action?.trim().toUpperCase() || null,
  };
  if (
    corrected.recordType === "TRADE" &&
    corrected.quantity !== null &&
    corrected.price !== null &&
    (corrected.action === "BUY" || corrected.action === "SELL")
  ) {
    corrected.amount = corrected.quantity * corrected.price;
    corrected.netCash =
      corrected.action === "BUY"
        ? -corrected.amount - (corrected.commission ?? 0)
        : corrected.amount - (corrected.commission ?? 0);
  }
  return corrected;
}

function inferAssetType(record: NormalizedImportRecord): string {
  if (/ETF/i.test(record.description ?? "")) return "ETF";
  if (/OPT|OPTION/i.test(record.assetClass ?? "")) return "OPTION";
  if (/BOND/i.test(record.assetClass ?? "")) return "BOND";
  return "STOCK";
}

function authoritativePosition(
  record: NormalizedImportRecord,
  baseCurrency: string,
): AccountingPosition {
  const quantity = record.quantity ?? 0;
  if (quantity < 0) throw new BadRequestException(`${record.symbol} 空头持仓需要人工处理`);
  const rate = record.currency === baseCurrency ? 1 : record.fxRateToBase!;
  const avgCost = quantity === 0 ? 0 : (Math.abs(record.costBasis ?? 0) * rate) / quantity;
  const currentPrice =
    record.currentPrice !== null
      ? record.currentPrice * rate
      : quantity === 0
        ? 0
        : (Math.abs(record.marketValue ?? 0) * rate) / quantity;
  return { symbol: record.symbol!, quantity, avgCost, currentPrice };
}

function normalizeSnapshotDate(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function latestRecordDate(records: NormalizedImportRecord[]): Date | null {
  const values = records
    .map((record) => (record.transactionDate ? new Date(record.transactionDate) : null))
    .filter((value): value is Date => value !== null)
    .sort((left, right) => left.getTime() - right.getTime());
  return values.at(-1) ?? null;
}
