import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import { BrokerConnectorClient } from "../broker-sync/broker-connector.client";
import type {
  CaptureIbkrTopOfBookDto,
  ImportStrategyEvidenceDto,
  SyncFredFinancingDto,
  SyncFredMarketFactorsDto,
  SyncSecFundamentalsDto,
} from "./strategy-evidence.dto";

const requiredStrategyMetricTypes = {
  DAYS_TO_COVER: "SHORT_INTEREST",
  FINANCIAL_CONDITIONS_Z: "FINANCING",
  FUNDAMENTAL_GROWTH_SCORE: "FUNDAMENTAL",
  ORDER_BOOK_IMBALANCE: "ORDER_BOOK",
  SHORT_INTEREST_PERCENT: "SHORT_INTEREST",
} as const;

const researchMetricTypes = {
  CBOE_VIX_CLOSE: "MACRO_MARKET",
  EFFECTIVE_FED_FUNDS_RATE: "MACRO_MARKET",
  FED_BROAD_DOLLAR_INDEX: "MACRO_MARKET",
} as const;

const metricTypes = { ...requiredStrategyMetricTypes, ...researchMetricTypes } as const;
const requiredMetrics = Object.keys(requiredStrategyMetricTypes) as Array<
  keyof typeof requiredStrategyMetricTypes
>;
const researchOnlyMetrics = Object.keys(researchMetricTypes) as Array<
  keyof typeof researchMetricTypes
>;

const fredMarketFactors = [
  {
    metricCode: "EFFECTIVE_FED_FUNDS_RATE",
    seriesId: "DFF",
    unit: "percent",
  },
  {
    metricCode: "FED_BROAD_DOLLAR_INDEX",
    seriesId: "DTWEXBGS",
    unit: "index-2006-100",
  },
  {
    metricCode: "CBOE_VIX_CLOSE",
    seriesId: "VIXCLS",
    unit: "index",
  },
] as const;

export function parseFredCurrentSnapshot(content: string) {
  const latest = content
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .reverse()
    .map((row) => row.split(","))
    .find((columns) => columns.length >= 2 && columns[1] && columns[1] !== ".");
  if (!latest?.[0] || !latest[1]) return null;
  const value = Number(latest[1]);
  return Number.isFinite(value) ? { observationDate: latest[0], value } : null;
}

type ObservationRow = Prisma.StrategyEvidenceObservationGetPayload<{
  include: { provider: { select: { code: true; name: true } } };
}>;

type SecFact = {
  end?: string;
  filed?: string;
  form?: string;
  fp?: string;
  val?: number;
};

@Injectable()
export class StrategyEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly connector: BrokerConnectorClient,
  ) {}

  async dashboard(symbolInput = "QQQM") {
    const symbol = this.symbol(symbolInput);
    const [providers, observations] = await Promise.all([
      this.prisma.strategyEvidenceProvider.findMany({ orderBy: { code: "asc" } }),
      this.prisma.strategyEvidenceObservation.findMany({
        where: { symbol: { in: [symbol, "GLOBAL"] }, verificationStatus: "VERIFIED" },
        include: { provider: { select: { code: true, name: true } } },
        orderBy: [{ availableAt: "desc" }, { createdAt: "desc" }],
        take: 200,
      }),
    ]);
    const latest = this.latestByMetric(observations);
    return {
      symbol,
      mode: "REQUIRE_VERIFIED_REAL",
      ready: requiredMetrics.every((metric) => latest.has(metric)),
      missingMetrics: requiredMetrics.filter((metric) => !latest.has(metric)),
      requiredMetrics,
      researchOnlyMetrics,
      providers: providers.map((provider) => ({
        ...provider,
        configured: this.providerConfigured(provider.code),
        config: provider.configJson ? JSON.parse(provider.configJson) : null,
      })),
      latest: [...latest.values()].map((row) => this.serialize(row)),
      observations: observations.slice(0, 50).map((row) => this.serialize(row)),
      safeguards: {
        acceptsFutureKnowledge: false,
        usesOnlyVerifiedEvidence: true,
        missingEvidenceAction: "BLOCK_ENTRY_OR_EXIT",
        note:
          "回测按 availableAt 对齐，只使用当时已经公开的数据；宏观研究因子不参与三层策略就绪判断，也不直接生成信号。",
      },
    };
  }

  async quantObservations(symbolInput: string, startDate: Date, endDate: Date) {
    const symbol = this.symbol(symbolInput);
    const lookback = new Date(startDate);
    lookback.setUTCDate(lookback.getUTCDate() - 180);
    const rows = await this.prisma.strategyEvidenceObservation.findMany({
      where: {
        symbol: { in: [symbol, "GLOBAL"] },
        metricCode: { in: requiredMetrics },
        verificationStatus: "VERIFIED",
        availableAt: { gte: lookback, lte: endDate },
      },
      include: { provider: { select: { code: true, name: true } } },
      orderBy: [{ availableAt: "asc" }, { observedAt: "asc" }],
      take: 20_000,
    });
    return rows.map((row) => ({
      symbol: row.symbol,
      metricCode: row.metricCode,
      value: toNumber(row.value),
      observedAt: row.observedAt.toISOString(),
      availableAt: row.availableAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      source: row.provider.code,
      verificationStatus: row.verificationStatus,
    }));
  }

  async importObservation(dto: ImportStrategyEvidenceDto) {
    const provider = await this.prisma.strategyEvidenceProvider.findUnique({
      where: { code: dto.providerCode },
    });
    if (!provider || !provider.enabled) throw new NotFoundException("策略证据 Provider 不存在或未启用");
    const evidenceType = metricTypes[dto.metricCode];
    if (provider.evidenceType !== evidenceType) {
      throw new BadRequestException("指标类型与 Provider 类型不一致");
    }
    this.validateOfficialSource(dto.sourceUrl, evidenceType);
    const observedAt = new Date(dto.observedAt);
    const availableAt = new Date(dto.availableAt);
    if (availableAt < observedAt) throw new BadRequestException("availableAt 不能早于 observedAt");
    if (availableAt.getTime() > Date.now() + 300_000) {
      throw new BadRequestException("不能导入尚未公开的未来证据");
    }
    this.validateMetricValue(dto.metricCode, dto.value);
    const row = await this.prisma.strategyEvidenceObservation.upsert({
      where: {
        providerId_symbol_metricCode_observedAt: {
          providerId: provider.id,
          symbol: this.symbol(dto.symbol),
          metricCode: dto.metricCode,
          observedAt,
        },
      },
      create: {
        providerId: provider.id,
        symbol: this.symbol(dto.symbol),
        evidenceType,
        metricCode: dto.metricCode,
        observedAt,
        availableAt,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        value: dto.value,
        unit: dto.unit,
        verificationStatus: "VERIFIED",
        derivation: dto.derivation,
        sourceUrl: dto.sourceUrl,
        rawDataJson: dto.rawData ? JSON.stringify(dto.rawData) : null,
      },
      update: {
        availableAt,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        value: dto.value,
        unit: dto.unit,
        verificationStatus: "VERIFIED",
        derivation: dto.derivation,
        sourceUrl: dto.sourceUrl,
        rawDataJson: dto.rawData ? JSON.stringify(dto.rawData) : null,
      },
      include: { provider: { select: { code: true, name: true } } },
    });
    await this.prisma.strategyEvidenceProvider.update({
      where: { id: provider.id },
      data: { lastHealthAt: new Date(), lastHealthStatus: "OK", lastSyncAt: new Date() },
    });
    return this.serialize(row);
  }

  async captureIbkrTopOfBook(dto: CaptureIbkrTopOfBookDto) {
    const snapshot = await this.connector.topOfBook(this.symbol(dto.symbol), dto.contractId);
    const totalSize = snapshot.bidSize + snapshot.askSize;
    if (totalSize <= 0) throw new BadRequestException("IBKR 盘口买卖量均为零，拒绝写入");
    return this.importObservation({
      availableAt: snapshot.snapshotTime,
      derivation: "(bidSize - askSize) / (bidSize + askSize)",
      metricCode: "ORDER_BOOK_IMBALANCE",
      observedAt: snapshot.snapshotTime,
      providerCode: "IBKR_TOP_OF_BOOK",
      rawData: snapshot,
      sourceUrl: "https://ibkrcampus.com/campus/ibkr-api-page/webapi-doc/",
      symbol: snapshot.symbol,
      unit: "ratio",
      value: (snapshot.bidSize - snapshot.askSize) / totalSize,
    });
  }

  async syncFred(dto: SyncFredFinancingDto) {
    const seriesId = dto.seriesId ?? "NFCI";
    if (seriesId !== "NFCI") {
      throw new BadRequestException("融资条件同步只允许官方 NFCI 序列");
    }
    const imported = await this.syncFredSeries({
      metricCode: "FINANCIAL_CONDITIONS_Z",
      observationStart: dto.observationStart,
      providerCode: "FRED_FINANCIAL_CONDITIONS",
      seriesId,
      unit: "z-score",
    });
    return { imported, seriesId };
  }

  async syncFredMarketFactors(dto: SyncFredMarketFactorsDto) {
    const vintageHistoryAvailable = this.fredApiKeyConfigured();
    const series = [];
    for (const factor of fredMarketFactors) {
      const imported = vintageHistoryAvailable
        ? await this.syncFredSeries({
            ...factor,
            observationStart: dto.observationStart,
            providerCode: "FRED_MACRO_MARKET",
          })
        : await this.syncFredCurrentSnapshot(factor);
      series.push({ imported, metricCode: factor.metricCode, seriesId: factor.seriesId });
    }
    return {
      createsOrder: false,
      createsSignal: false,
      historyMode: vintageHistoryAvailable
        ? "INITIAL_RELEASE_HISTORY"
        : "CURRENT_SNAPSHOT_ONLY",
      researchOnly: true,
      series,
    };
  }

  private async syncFredCurrentSnapshot(input: (typeof fredMarketFactors)[number]) {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 45);
    const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
    url.searchParams.set("cosd", start.toISOString().slice(0, 10));
    url.searchParams.set("id", input.seriesId);
    const content = await this.fetchText(url);
    const latest = parseFredCurrentSnapshot(content);
    if (!latest) {
      throw new BadRequestException(`FRED ${input.seriesId} 当前快照没有可用数据`);
    }
    const synchronizedAt = new Date().toISOString();
    await this.importObservation({
      availableAt: synchronizedAt,
      derivation:
        `${input.seriesId} FRED 当前公开快照；未配置 API Key，` +
        "availableAt 固定为本次同步时间，不得用于历史回填",
      metricCode: input.metricCode,
      observedAt: `${latest.observationDate}T00:00:00.000Z`,
      providerCode: "FRED_MACRO_MARKET",
      rawData: {
        historicalBackfillEligible: false,
        observationDate: latest.observationDate,
        synchronizedAt,
        value: latest.value,
      },
      sourceUrl: `https://fred.stlouisfed.org/series/${input.seriesId}`,
      symbol: "GLOBAL",
      unit: input.unit,
      value: latest.value,
    });
    return 1;
  }

  private async syncFredSeries(input: {
    metricCode: keyof typeof metricTypes;
    observationStart?: string;
    providerCode: "FRED_FINANCIAL_CONDITIONS" | "FRED_MACRO_MARKET";
    seriesId: string;
    unit: string;
  }) {
    const apiKey = this.config.get<string>("FRED_API_KEY", "").trim();
    if (!/^[a-z0-9]{32}$/.test(apiKey)) throw new BadRequestException("尚未配置 FRED_API_KEY");
    const url = new URL("https://api.stlouisfed.org/fred/series/observations");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("file_type", "json");
    url.searchParams.set(
      "observation_start",
      input.observationStart?.slice(0, 10) ?? "2000-01-01",
    );
    url.searchParams.set("output_type", "4");
    url.searchParams.set("series_id", input.seriesId);
    const payload = await this.fetchJson<{ observations?: Array<Record<string, string>> }>(url);
    let imported = 0;
    for (const row of payload.observations ?? []) {
      if (!row.date || !row.value || row.value === ".") continue;
      const value = Number(row.value);
      if (!Number.isFinite(value)) continue;
      const availableAt = row.realtime_start ?? row.date;
      await this.importObservation({
        availableAt: `${availableAt.slice(0, 10)}T00:00:00.000Z`,
        derivation: `${input.seriesId} 初次发布值；FRED output_type=4；仅作研究观察`,
        metricCode: input.metricCode,
        observedAt: `${row.date}T00:00:00.000Z`,
        providerCode: input.providerCode,
        rawData: row,
        sourceUrl: `https://fred.stlouisfed.org/series/${input.seriesId}`,
        symbol: "GLOBAL",
        unit: input.unit,
        value,
      });
      imported += 1;
    }
    return imported;
  }

  async syncSec(dto: SyncSecFundamentalsDto) {
    const userAgent = this.config.get<string>("SEC_USER_AGENT", "").trim();
    if (!userAgent.includes("@")) {
      throw new BadRequestException("尚未配置 SEC_USER_AGENT（需包含可联系邮箱）");
    }
    const url = new URL(`https://data.sec.gov/api/xbrl/companyfacts/CIK${dto.cik}.json`);
    const payload = await this.fetchJson<Record<string, unknown>>(url, { "User-Agent": userAgent });
    const facts = (payload.facts ?? {}) as Record<string, Record<string, unknown>>;
    const usGaap = (facts["us-gaap"] ?? {}) as Record<string, Record<string, unknown>>;
    const revenue = this.annualFacts(usGaap, [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
    ]);
    const income = this.annualFacts(usGaap, ["NetIncomeLoss"]);
    if (revenue.length < 2 || income.length < 2) {
      throw new BadRequestException("SEC Company Facts 中没有足够的两期年度收入与净利润数据");
    }
    const revenueGrowth = this.growth(revenue[0]!.val!, revenue[1]!.val!);
    const incomeGrowth = this.growth(income[0]!.val!, income[1]!.val!);
    const score = Math.max(-1, Math.min(1, (revenueGrowth / 0.2 + incomeGrowth / 0.3) / 2));
    const latestFiled = [revenue[0]!.filed!, income[0]!.filed!].sort().at(-1)!;
    const latestEnd = [revenue[0]!.end!, income[0]!.end!].sort().at(-1)!;
    return this.importObservation({
      availableAt: `${latestFiled}T00:00:00.000Z`,
      derivation: "clamp(mean(revenueYoY/20%, netIncomeYoY/30%), -1, 1)",
      metricCode: "FUNDAMENTAL_GROWTH_SCORE",
      observedAt: `${latestEnd}T00:00:00.000Z`,
      providerCode: "SEC_COMPANYFACTS",
      rawData: { cik: dto.cik, income: income.slice(0, 2), incomeGrowth, revenue: revenue.slice(0, 2), revenueGrowth },
      sourceUrl: url.toString(),
      symbol: dto.symbol,
      unit: "score",
      value: score,
    });
  }

  private annualFacts(namespace: Record<string, Record<string, unknown>>, tags: string[]) {
    for (const tag of tags) {
      const units = (namespace[tag]?.units ?? {}) as Record<string, SecFact[]>;
      const rows = (units.USD ?? [])
        .filter((row) => row.form === "10-K" && row.fp === "FY" && row.end && row.filed && Number.isFinite(row.val))
        .sort((left, right) => right.end!.localeCompare(left.end!));
      const distinct = rows.filter((row, index) => rows.findIndex((item) => item.end === row.end) === index);
      if (distinct.length >= 2) return distinct;
    }
    return [];
  }

  private growth(current: number, previous: number) {
    return previous === 0 ? 0 : (current - previous) / Math.abs(previous);
  }

  private async fetchJson<T>(url: URL, headers: Record<string, string> = {}) {
    const response = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new BadRequestException(`官方数据接口返回 ${response.status}`);
    return (await response.json()) as T;
  }

  private async fetchText(url: URL) {
    const response = await fetch(url, {
      headers: { Accept: "text/csv" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new BadRequestException(`官方数据接口返回 ${response.status}`);
    return response.text();
  }

  private latestByMetric(rows: ObservationRow[]) {
    const latest = new Map<string, ObservationRow>();
    for (const row of rows) if (!latest.has(row.metricCode)) latest.set(row.metricCode, row);
    return latest;
  }

  private providerConfigured(code: string) {
    if (code === "SEC_COMPANYFACTS") return this.config.get<string>("SEC_USER_AGENT", "").includes("@");
    if (code === "FRED_FINANCIAL_CONDITIONS") return this.fredApiKeyConfigured();
    if (code === "FRED_MACRO_MARKET") return true;
    if (code === "IBKR_TOP_OF_BOOK") return this.config.get<string>("BROKER_CONNECTOR_MODE", "OFFLINE") !== "OFFLINE";
    return true;
  }

  private serialize(row: ObservationRow) {
    return {
      ...row,
      availableAt: row.availableAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      observedAt: row.observedAt.toISOString(),
      rawData: row.rawDataJson ? JSON.parse(row.rawDataJson) : null,
      value: toNumber(row.value),
    };
  }

  private symbol(value: string) {
    const symbol = value.trim().toUpperCase();
    if (!/^[A-Z0-9._-]{1,32}$/.test(symbol)) throw new BadRequestException("symbol 格式无效");
    return symbol;
  }

  private validateMetricValue(metric: keyof typeof metricTypes, value: number) {
    if (!Number.isFinite(value)) throw new BadRequestException("证据值必须是有限数字");
    if ((metric === "FUNDAMENTAL_GROWTH_SCORE" || metric === "ORDER_BOOK_IMBALANCE") && (value < -1 || value > 1)) {
      throw new BadRequestException(`${metric} 必须位于 -1 到 1`);
    }
    if ((metric === "SHORT_INTEREST_PERCENT" || metric === "DAYS_TO_COVER") && value < 0) {
      throw new BadRequestException(`${metric} 不能为负数`);
    }
    if (metric === "EFFECTIVE_FED_FUNDS_RATE" && (value < -10 || value > 100)) {
      throw new BadRequestException("EFFECTIVE_FED_FUNDS_RATE 超出合理范围");
    }
    if (metric === "FED_BROAD_DOLLAR_INDEX" && (value <= 0 || value > 1_000)) {
      throw new BadRequestException("FED_BROAD_DOLLAR_INDEX 超出合理范围");
    }
    if (metric === "CBOE_VIX_CLOSE" && (value < 0 || value > 500)) {
      throw new BadRequestException("CBOE_VIX_CLOSE 超出合理范围");
    }
  }

  private fredApiKeyConfigured() {
    return /^[a-z0-9]{32}$/.test(this.config.get<string>("FRED_API_KEY", ""));
  }

  private validateOfficialSource(sourceUrl: string, evidenceType: string) {
    const hostname = new URL(sourceUrl).hostname.toLowerCase();
    const allowed: Record<string, string[]> = {
      FINANCING: ["fred.stlouisfed.org", "api.stlouisfed.org"],
      MACRO_MARKET: ["fred.stlouisfed.org", "api.stlouisfed.org"],
      FUNDAMENTAL: ["sec.gov", "www.sec.gov", "data.sec.gov"],
      ORDER_BOOK: ["ibkrcampus.com", "www.interactivebrokers.com", "interactivebrokers.com"],
      SHORT_INTEREST: ["finra.org", "www.finra.org", "api.finra.org", "nasdaq.com", "www.nasdaq.com"],
    };
    if (!allowed[evidenceType]?.includes(hostname)) {
      throw new BadRequestException("sourceUrl 不是该证据类型允许的官方域名");
    }
  }
}
