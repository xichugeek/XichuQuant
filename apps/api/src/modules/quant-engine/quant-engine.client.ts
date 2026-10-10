import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class QuantEngineClient {
  private readonly logger = new Logger(QuantEngineClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>("QUANT_ENGINE_URL", "http://localhost:5091");
    this.timeoutMs = config.get<number>("QUANT_ENGINE_TIMEOUT_MS", 120_000);
  }

  health(): Promise<unknown> {
    return this.request("/health", "GET");
  }

  version(): Promise<unknown> {
    return this.request("/version", "GET");
  }

  validateStrategy<T>(body: unknown): Promise<T> {
    return this.request<T>("/strategies/validate", "POST", body);
  }

  calculateIndicator<T>(body: unknown): Promise<T> {
    return this.request<T>("/indicators/calculate", "POST", body);
  }

  runBacktest<T>(body: unknown): Promise<T> {
    return this.request<T>("/backtests/run", "POST", body);
  }

  runValidation<T>(body: unknown): Promise<T> {
    return this.request<T>("/validations/run", "POST", body);
  }

  generateSignal<T>(body: unknown): Promise<T> {
    return this.request<T>("/signals/generate", "POST", body);
  }

  analyzePortfolio<T>(body: unknown): Promise<T> {
    return this.request<T>("/portfolios/analyze", "POST", body);
  }

  private async request<T = unknown>(path: string, method: "GET" | "POST", body?: unknown) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as T | { detail?: unknown } | null;
      if (!response.ok) {
        this.logger.warn({ durationMs: Date.now() - startedAt, path, status: response.status });
        throw new ServiceUnavailableException({
          message: "量化计算服务拒绝了请求",
          quantEngineStatus: response.status,
          detail: payload,
        });
      }
      this.logger.debug({ durationMs: Date.now() - startedAt, path, status: response.status });
      return payload as T;
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      const message = error instanceof Error ? error.message : "unknown error";
      this.logger.error({ durationMs: Date.now() - startedAt, message, path });
      throw new ServiceUnavailableException({
        message: "量化计算服务当前不可用，现有账户与风控功能不受影响",
        service: this.baseUrl,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
