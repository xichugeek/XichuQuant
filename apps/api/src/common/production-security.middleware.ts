import { createHash, randomUUID } from "node:crypto";

import { Injectable, type NestMiddleware } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NextFunction, Request, Response } from "express";

import { PrismaService } from "../prisma/prisma.service";
import { publicDemoMethodAllowed } from "./deployment-safety";

type RateBucket = { count: number; resetAt: number };

@Injectable()
export class ProductionSecurityMiddleware implements NestMiddleware {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async use(request: Request, response: Response, next: NextFunction) {
    // Express removes the mounted route from request.path inside Nest middleware.
    const path = (request.originalUrl ?? request.path).split("?")[0] ?? "";
    const incoming = request.header("x-correlation-id");
    const correlationId = incoming && /^[a-zA-Z0-9:_-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    request.headers["x-correlation-id"] = correlationId;
    response.setHeader("X-Correlation-Id", correlationId);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if (!this.rateLimitAllows(request)) {
      response.setHeader("Retry-After", "60");
      response.status(429).json({ message: "请求过于频繁，请稍后重试" });
      return;
    }
    if (this.config.get<string>("PUBLIC_DEMO_READ_ONLY", "false") === "true" && !publicDemoMethodAllowed(request.method, path)) {
      response.status(403).json({ message: "DEMO MODE is read-only: uploads, trading, configuration and compute mutations are disabled." });
      return;
    }
    if (this.config.get("NODE_ENV") === "production") {
      response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      if (
        this.config.get<string>("REQUIRE_HTTPS", "true") === "true" &&
        !(path === "/health" && request.method === "GET") &&
        !request.secure
      ) {
        response.status(426).json({ message: "生产环境必须通过 HTTPS 访问" });
        return;
      }
      const isLogin = path === "/auth/login" && request.method === "POST";
      const isPublicHealth = path === "/health" && request.method === "GET";
      const isPreflight = request.method === "OPTIONS";
      const isMutation = !new Set(["GET", "HEAD", "OPTIONS"]).has(request.method);
      if (isMutation) {
        const origins = this.allowedOrigins();
        const origin = request.header("origin");
        if (!origin || !origins.has(origin)) {
          response.status(403).json({ message: "请求来源不在生产白名单" });
          return;
        }
      }
      if (!isLogin && !isPublicHealth && !isPreflight) {
        const cookieValues = this.cookies(request.header("cookie"));
        const sessionToken = cookieValues.xichu_session;
        if (!sessionToken) {
          response.status(401).json({ message: "生产会话不存在或已过期" });
          return;
        }
        const session = await this.prisma.userSession.findUnique({
          where: { tokenHash: this.hash(sessionToken) },
        });
        if (!session || session.revokedAt || session.expiresAt <= new Date()) {
          response.status(401).json({ message: "生产会话不存在或已过期" });
          return;
        }
        if (isMutation) {
          const csrfToken = request.header("x-csrf-token");
          if (
            !csrfToken ||
            !cookieValues.xichu_csrf ||
            csrfToken !== cookieValues.xichu_csrf ||
            this.hash(csrfToken) !== session.csrfHash
          ) {
            response.status(403).json({ message: "CSRF 双提交令牌校验失败" });
            return;
          }
        }
        if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1_000) {
          await this.prisma.userSession.update({
            where: { id: session.id },
            data: { lastSeenAt: new Date() },
          });
        }
      }
    }
    next();
  }

  private cookies(value: string | undefined) {
    return Object.fromEntries(
      (value ?? "")
        .split(";")
        .map((item) => item.trim().split("="))
        .filter((item): item is [string, string] => item.length === 2 && Boolean(item[0]))
      .flatMap(([key, item]) => { try { return [[key, decodeURIComponent(item)]]; } catch { return []; } }),
    );
  }

  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private allowedOrigins() {
    return new Set(
      this.config
        .get<string>("WEB_ORIGIN", "http://localhost:5088")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }

  private rateLimitAllows(request: Request) {
    const now = Date.now();
    const address = request.ip || request.socket.remoteAddress || "unknown";
    const path = (request.originalUrl ?? request.path).split("?")[0];
    if (path === "/auth/login" && request.method === "POST") {
      if (!this.consumeRateBucket(`${address}:login`, 10, now)) return false;
      if (this.config.get<string>("PUBLIC_DEMO_READ_ONLY", "false") === "true" &&
          !this.consumeRateBucket("demo:login:global", 60, now)) return false;
    }
    const scope = path?.startsWith("/paper-execution") ? "paper" : "api";
    const key = `${address}:${scope}`;
    const max = scope === "paper" ? 120 : 600;
    return this.consumeRateBucket(key, max, now);
  }

  private consumeRateBucket(key: string, max: number, now: number) {
    if (this.buckets.size >= 10_000) {
      for (const [bucketKey, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(bucketKey);
      }
    }
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && this.buckets.size >= 10_000) return false;
      this.buckets.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    current.count += 1;
    return current.count <= max;
  }
}
