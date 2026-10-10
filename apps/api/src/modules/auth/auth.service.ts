import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../../prisma/prisma.service";
import { publicDemoSessionLimit } from "../../common/deployment-safety";

const FAILURE_WINDOW_MS = 15 * 60 * 1_000;
const MAX_FAILURES = 5;

export function strongPassword(value: string) {
  return (
    value.length >= 12 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function verifyScrypt(password: string, encoded: string) {
  const [algorithm, salt, expectedHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex || expectedHex.length !== 128) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async login(usernameInput: string, password: string, address: string) {
    const username = usernameInput.trim().toLowerCase();
    const addressHash = hash(address);
    const since = new Date(Date.now() - FAILURE_WINDOW_MS);
    const demo = this.config.get<string>("PUBLIC_DEMO_READ_ONLY", "false") === "true";
    if (demo) await this.prisma.loginAttempt.deleteMany({ where: { occurredAt: { lt: since } } });
    const failures = await this.prisma.loginAttempt.count({
      where: { addressHash, normalizedUsername: username, occurredAt: { gte: since }, succeeded: false },
    });
    if (failures >= MAX_FAILURES) {
      throw new HttpException("登录失败次数过多，请 15 分钟后再试", HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.user.findUnique({ where: { username } });
    const accepted = Boolean(user && strongPassword(password) && verifyScrypt(password, user.passwordHash));
    await this.prisma.loginAttempt.create({
      data: { addressHash, normalizedUsername: username, succeeded: accepted },
    });
    if (!accepted || !user) throw new UnauthorizedException("用户名或密码错误");

    const sessionToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const ttlHours = Math.min(
      demo ? 4 : 24,
      Math.max(1, Number(this.config.get<string>("SESSION_TTL_HOURS", demo ? "1" : "8")) || (demo ? 1 : 8)),
    );
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1_000);
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const now = new Date();
          if (demo) {
            await tx.userSession.deleteMany({
              where: { userId: user.id, OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }] },
            });
            const limit = publicDemoSessionLimit(this.config.get<string>("PUBLIC_DEMO_MAX_SESSIONS"));
            const active = await tx.userSession.count({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: now } } });
            if (active >= limit) {
              throw new HttpException("演示访客会话已达上限，请在其他会话退出或到期后重试", HttpStatus.TOO_MANY_REQUESTS);
            }
          } else {
            await tx.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
          }
          await tx.userSession.create({
            data: { csrfHash: hash(csrfToken), expiresAt, lastSeenAt: now, tokenHash: hash(sessionToken), userId: user.id },
          });
        }, { isolationLevel: "Serializable" });
        break;
      } catch (error) {
        // SQL Server can choose a deadlock victim when concurrent logins fill the last slot.
        // Retry the complete transaction; never evict another visitor or exceed the cap.
        if (attempt >= 2 || !error || typeof error !== "object" || !("code" in error) || error.code !== "P2034") throw error;
      }
    }
    return {
      csrfToken,
      displayName: user.displayName ?? user.username,
      expiresAt,
      sessionToken,
      username: user.username,
    };
  }

  async logout(sessionToken: string | undefined) {
    if (!sessionToken) return;
    await this.prisma.userSession.updateMany({
      where: { tokenHash: hash(sessionToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
