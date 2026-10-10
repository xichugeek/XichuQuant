import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

const allocationModes = [
  "FIXED_PERCENT",
  "EQUAL_WEIGHT",
  "INVERSE_VOLATILITY",
  "RISK_BUDGET",
  "MANUAL_AMOUNT",
] as const;
const rebalanceModes = ["MANUAL", "SCHEDULED", "THRESHOLD", "RISK_TRIGGERED"] as const;
const conflictPolicies = ["NETTING", "PRIORITY", "REJECT_CONFLICT", "MANUAL_REVIEW"] as const;

export class CreatePortfolioDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() baseCurrency?: string;
  @Type(() => Number) @IsNumber() @Min(1000) initialCapital!: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(80) cashReservePercent!: number;
  @IsIn(allocationModes) allocationMode!: (typeof allocationModes)[number];
  @IsIn(rebalanceModes) rebalanceMode!: (typeof rebalanceModes)[number];
  @IsOptional() @IsIn(conflictPolicies) conflictPolicy?: (typeof conflictPolicies)[number];
}

export class AddPortfolioStrategyDto {
  @IsString() strategyId!: string;
  @IsOptional() @IsString() strategyDeploymentId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(999) priority?: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) targetAllocationPercent!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) manualAmount?: number;
  @Type(() => Number) @IsNumber() @Min(0.1) @Max(100) maxCapitalPercent!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.000001) volatility?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.000001) riskBudget?: number;
}

export class AllocationItemDto {
  @IsString() portfolioStrategyId!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) targetAllocationPercent?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) manualAmount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.000001) volatility?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.000001) riskBudget?: number;
}

export class UpdatePortfolioAllocationDto {
  @IsIn(allocationModes) allocationMode!: (typeof allocationModes)[number];
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllocationItemDto)
  items!: AllocationItemDto[];
}

export class UpdatePortfolioRiskDto {
  @Type(() => Number) @IsNumber() @Min(1) @Max(100) singleStrategyMaxPercent!: number;
  @Type(() => Number) @IsNumber() @Min(1) @Max(100) singleSymbolMaxPercent!: number;
  @Type(() => Number) @IsNumber() @Min(1) @Max(100) singleThemeMaxPercent!: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) leveragedEtfMaxPercent!: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) leveragedStrategyMaxPercent!: number;
  @Type(() => Number) @IsNumber() @Min(1) @Max(100) correlatedStrategiesMaxPercent!: number;
  @Type(() => Number) @IsNumber() @Min(-1) @Max(1) correlationThreshold!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) maxConcurrentPositions!: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) minCashPercent!: number;
  @Type(() => Number) @IsNumber() @Min(0.1) @Max(100) maxDailyLossPercent!: number;
  @Type(() => Number) @IsNumber() @Min(0.1) @Max(100) maxDrawdownPercent!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) maxLosingStrategies!: number;
  @Type(() => Number) @IsNumber() @Min(1) @Max(100) maxStrategyDrawdownContributionPercent!: number;
}

export class PortfolioStatusDto {
  @IsIn([
    "VALIDATE",
    "APPROVE",
    "START",
    "PAUSE",
    "STOP",
    "RESUME",
    "NO_NEW_POSITIONS",
    "READ_ONLY",
    "CANCEL_OPEN_ORDERS",
  ])
  action!:
    | "VALIDATE"
    | "APPROVE"
    | "START"
    | "PAUSE"
    | "STOP"
    | "RESUME"
    | "NO_NEW_POSITIONS"
    | "READ_ONLY"
    | "CANCEL_OPEN_ORDERS";
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class PortfolioStrategyStatusDto {
  @IsIn(["PAUSE", "RESUME"]) action!: "PAUSE" | "RESUME";
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class PreviewPortfolioRunDto {
  @IsString() tradeDate!: string;
  @IsOptional() @IsIn(rebalanceModes) runType?: (typeof rebalanceModes)[number];
  @IsOptional() @IsIn(conflictPolicies) conflictPolicy?: (typeof conflictPolicies)[number];
  @IsOptional() @IsArray() @IsString({ each: true }) signalIds?: string[];
  @IsOptional() @IsBoolean() execute?: boolean;
}

export class PortfolioCorrelationDto {
  @IsArray() @IsObject({ each: true }) strategyReturns!: Array<Record<string, number>>;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(252) rollingWindow?: number;
}
