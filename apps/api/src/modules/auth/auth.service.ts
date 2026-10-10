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
      24,
      Math.max(1, Number(this.config.get<string>("SESSION_TTL_HOURS", "8"))),
    );
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1_000);
    await this.prisma.$transaction([
      this.prisma.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.userSession.create({
        data: {
          csrfHash: hash(csrfToken),
          expiresAt,
          lastSeenAt: new Date(),
          tokenHash: hash(sessionToken),
          userId: user.id,
        },
      }),
    ]);
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
