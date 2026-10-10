export type ObservationEligibilityInput = {
  eventCount: number;
  maxDrawdown: number;
  maxDrawdownLimit: number;
  returnDeviation: number;
  riskRejectedCount: number;
  runningTradingDays: number;
  requiredTradingDays: number;
};

export function dailyCycleKey(marketDate: string, providerCode: string) {
  return `DAILY_CYCLE:${marketDate}:${providerCode}`;
}

export function qualityAllowsStrategy(input: {
  invalidOhlcCount: number;
  latestComplete: boolean;
  missingDayCount: number;
  zeroVolumeCount: number;
}) {
  return (
    input.latestComplete &&
    input.missingDayCount === 0 &&
    input.invalidOhlcCount === 0 &&
    input.zeroVolumeCount === 0
  );
}

export function observationIsEligible(input: ObservationEligibilityInput) {
  return (
    input.runningTradingDays >= input.requiredTradingDays &&
    input.eventCount > 0 &&
    Math.abs(input.maxDrawdown) <= input.maxDrawdownLimit &&
    Math.abs(input.returnDeviation) <= 10 &&
    input.riskRejectedCount === 0
  );
}

export function taskCanRetry(status: string, attemptCount: number, maxAttempts: number) {
  return ["FAILED", "RETRYING"].includes(status) && attemptCount < maxAttempts;
}
