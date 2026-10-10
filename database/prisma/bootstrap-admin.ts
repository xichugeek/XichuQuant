import "../../apps/api/src/common/isolated-environment";
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

export function validAdminPassword(password: string) {
  return password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

export async function bootstrapAdmin(prisma: PrismaClient, username: string, password: string) {
  if (!/^[a-z][a-z0-9._-]{2,63}$/.test(username) || !validAdminPassword(password)) {
    throw new Error("Configure ADMIN_USERNAME and a strong ADMIN_PASSWORD locally (12+ characters, upper/lowercase, number and special character).");
  }
  // Initialization never overwrites an existing administrator, password or account.
  if (await prisma.user.count()) throw new Error("A user already exists. Administrator initialization refuses to alter existing users.");
  const salt = randomBytes(16).toString("hex");
  await prisma.user.create({ data: { username, displayName: "Local administrator", passwordHash: `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}` } });
}

if (require.main === module) {
  const prisma = new PrismaClient();
  void bootstrapAdmin(prisma, process.env.ADMIN_USERNAME ?? "admin", process.env.ADMIN_PASSWORD ?? "")
    .then(() => console.log("Administrator created; no account, position or trading history was imported."))
    .catch(() => { console.error("Administrator initialization refused. Check the password policy, database migrations and whether a user already exists. Credentials are not printed."); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
