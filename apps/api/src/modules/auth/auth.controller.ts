import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";

import { AuthService } from "./auth.service";
import { LoginDto } from "./auth.dto";

function cookies(value: string | undefined) {
  return Object.fromEntries(
    (value ?? "")
      .split(";")
      .map((item) => item.trim().split("="))
      .filter((item): item is [string, string] => item.length === 2 && Boolean(item[0]))
      .map(([key, item]) => [key, decodeURIComponent(item)]),
  );
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post("login")
  async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const address = request.ip || request.socket.remoteAddress || "unknown";
    const result = await this.service.login(dto.username, dto.password, address);
    const secure = this.config.get("NODE_ENV") === "production";
    const maxAge = Math.max(0, result.expiresAt.getTime() - Date.now());
    response.cookie("xichu_session", result.sessionToken, {
      httpOnly: true,
      maxAge,
      sameSite: "strict",
      secure,
    });
    response.cookie("xichu_csrf", result.csrfToken, {
      httpOnly: false,
      maxAge,
      sameSite: "strict",
      secure,
    });
    return {
      csrfToken: result.csrfToken,
      displayName: result.displayName,
      expiresAt: result.expiresAt,
      username: result.username,
    };
  }

  @Get("session")
  session(@Req() request: Request) {
    return { authenticated: true, correlationId: request.header("x-correlation-id") ?? null };
  }

  @Post("logout")
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.service.logout(cookies(request.header("cookie")).xichu_session);
    response.clearCookie("xichu_session", { httpOnly: true, sameSite: "strict", secure: this.config.get("NODE_ENV") === "production" });
    response.clearCookie("xichu_csrf", { sameSite: "strict", secure: this.config.get("NODE_ENV") === "production" });
    return { loggedOut: true };
  }
}
