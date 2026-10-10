import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { ScheduleModule } from "@nestjs/schedule";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AccountModule } from "./modules/accounts/account.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BacktestModule } from "./modules/backtests/backtest.module";
import { BrokerSyncModule } from "./modules/broker-sync/broker-sync.module";
import { BrokerPaperModule } from "./modules/broker-execution/broker-paper.module";
import { CertificationModule } from "./modules/certification/certification.module";
import { InstrumentModule } from "./modules/instruments/instrument.module";
import { ImportModule } from "./modules/imports/import.module";
import { MarketDataModule } from "./modules/market-data/market-data.module";
import { MarketResearchModule } from "./modules/market-research/market-research.module";
import { OperationsModule } from "./modules/operations/operations.module";
import { PaperTradingModule } from "./modules/paper-trading/paper-trading.module";
import { PortfolioModule } from "./modules/portfolios/portfolio.module";
import { PositionModule } from "./modules/positions/position.module";
import { QuantEngineModule } from "./modules/quant-engine/quant-engine.module";
import { ReviewModule } from "./modules/reviews/review.module";
import { RiskAlertModule } from "./modules/risk-alerts/risk-alert.module";
import { RiskRuleModule } from "./modules/risk-rules/risk-rule.module";
import { RiskModule } from "./modules/risk/risk.module";
import { RiskDisciplineModule } from "./modules/risk-discipline/risk-discipline.module";
import { SignalModule } from "./modules/signals/signal.module";
import { StrategyModule } from "./modules/strategies/strategy.module";
import { StrategyEvidenceModule } from "./modules/strategy-evidence/strategy-evidence.module";
import { StrategyValidationModule } from "./modules/strategy-validations/strategy-validation.module";
import { TradePlanModule } from "./modules/trade-plans/trade-plan.module";
import { TradeModule } from "./modules/trades/trade.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProductionSecurityMiddleware } from "./common/production-security.middleware";

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ["../../.env", ".env"],
      ignoreEnvFile: process.env.XICHURISK_ENV_ISOLATED === "true",
      isGlobal: true,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: true,
        customProps: (request) => ({
          correlationId: request.headers["x-correlation-id"] ?? request.id,
        }),
        level: process.env.NODE_ENV === "production" ? "info" : "debug",
        redact: ["req.headers.authorization", "req.headers.cookie", "req.headers['x-csrf-token']", "res.headers['set-cookie']", "req.body.password"],
        transport:
          process.env.NODE_ENV === "production"
            ? undefined
            : {
                target: "pino-pretty",
                options: {
                  colorize: true,
                  singleLine: true,
                  translateTime: "SYS:standard",
                },
              },
      },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    AccountModule,
    InstrumentModule,
    ImportModule,
    MarketDataModule,
    MarketResearchModule,
    OperationsModule,
    PaperTradingModule,
    PortfolioModule,
    QuantEngineModule,
    StrategyModule,
    StrategyEvidenceModule,
    StrategyValidationModule,
    SignalModule,
    BacktestModule,
    BrokerPaperModule,
    CertificationModule,
    BrokerSyncModule,
    RiskModule,
    RiskDisciplineModule,
    PositionModule,
    RiskRuleModule,
    RiskAlertModule,
    TradePlanModule,
    TradeModule,
    ReviewModule,
  ],
  controllers: [AppController],
  providers: [AppService, ProductionSecurityMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ProductionSecurityMiddleware).forRoutes("*");
  }
}
