import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../../prisma/prisma.service";
import { BrokerConnectorClient } from "../broker-sync/broker-connector.client";
import {
  parseFredCurrentSnapshot,
  StrategyEvidenceService,
} from "./strategy-evidence.service";

function service(prisma: object, values: Record<string, string> = {}) {
  const config = {
    get: (key: string, fallback = "") => values[key] ?? fallback,
  } as ConfigService;
  return new StrategyEvidenceService(
    prisma as PrismaService,
    config,
    {} as BrokerConnectorClient,
  );
}

test("宏观研究因子不会进入量化策略必需证据查询", async () => {
  let where: Record<string, unknown> | undefined;
  const subject = service({
    strategyEvidenceObservation: {
      findMany: (args: { where: Record<string, unknown> }) => {
        where = args.where;
        return Promise.resolve([]);
      },
    },
  });

  await subject.quantObservations(
    "QQQM",
    new Date("2026-01-01T00:00:00.000Z"),
    new Date("2026-08-24T00:00:00.000Z"),
  );

  assert.deepEqual((where?.metricCode as { in: string[] }).in.sort(), [
    "DAYS_TO_COVER",
    "FINANCIAL_CONDITIONS_Z",
    "FUNDAMENTAL_GROWTH_SCORE",
    "ORDER_BOOK_IMBALANCE",
    "SHORT_INTEREST_PERCENT",
  ]);
});

test("宏观研究因子不改变三层策略就绪条件", async () => {
  const subject = service({
    strategyEvidenceObservation: { findMany: async () => [] },
    strategyEvidenceProvider: { findMany: async () => [] },
  });

  const dashboard = await subject.dashboard("QQQM");

  assert.equal(dashboard.ready, false);
  assert.equal(dashboard.requiredMetrics.length, 5);
  assert.deepEqual(dashboard.researchOnlyMetrics.sort(), [
    "CBOE_VIX_CLOSE",
    "EFFECTIVE_FED_FUNDS_RATE",
    "FED_BROAD_DOLLAR_INDEX",
  ]);
  assert.equal(dashboard.safeguards.acceptsFutureKnowledge, false);
});

test("融资条件接口拒绝把任意 FRED 序列冒充 NFCI", async () => {
  const subject = service({});

  await assert.rejects(
    () => subject.syncFred({ seriesId: "VIXCLS" }),
    (error: unknown) =>
      error instanceof BadRequestException && error.message.includes("只允许官方 NFCI"),
  );
});

test("FRED 当前快照只采用最后一个有效官方观测值", () => {
  const result = parseFredCurrentSnapshot(
    "observation_date,VIXCLS\n2026-08-20,16.01\n2026-08-21,.\n",
  );

  assert.deepEqual(result, { observationDate: "2026-08-20", value: 16.01 });
  assert.equal(parseFredCurrentSnapshot("observation_date,DFF\n2026-08-20,.\n"), null);
});
