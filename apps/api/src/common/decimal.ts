import type { Prisma } from "@prisma/client";

export type DecimalValue = Prisma.Decimal | number | string | null | undefined;

export function toNumber(value: DecimalValue): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}
