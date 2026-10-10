import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertDemoSeedTarget } from "../../database/prisma/seed-safety";
import { bootstrapAdmin } from "../../database/prisma/bootstrap-admin";
import { assertPublicDemoDatabase } from "../../apps/api/src/common/deployment-safety";

test("Administrator initialization refuses to overwrite an existing user or password", async () => {
  assertDemoSeedTarget(process.env.DATABASE_URL,process.env.SEED_DEMO_CONFIRM);
  const db=new PrismaClient();
  try {
    const before=await db.user.findMany();
    await assert.rejects(()=>bootstrapAdmin(db,"admin","Synthetic-2026-OtherPassword!"),/already exists/);
    assert.deepEqual(await db.user.findMany(),before);
  } finally { await db.$disconnect(); }
});
test("Public Demo checks actual database contents and rejects another account origin", async () => {
  assertDemoSeedTarget(process.env.DATABASE_URL,process.env.SEED_DEMO_CONFIRM);
  const db=new PrismaClient();
  try {
    await assertPublicDemoDatabase(db);
    await assert.rejects(db.$transaction(async tx=>{
      const user=await tx.user.findFirstOrThrow();
      await tx.account.create({data:{userId:user.id,name:"SYNTHETIC deliberately invalid origin",dataOrigin:"UNKNOWN",totalEquity:1000,cashBalance:1000}});
      await assert.rejects(()=>assertPublicDemoDatabase(tx),/refuses/);
      throw new Error("ROLLBACK_VALIDATED");
    }),/ROLLBACK_VALIDATED/);
    await assertPublicDemoDatabase(db);
  } finally { await db.$disconnect(); }
});
test("Public Demo rejects historical bars instead of assuming a Demo database name proves privacy", async () => {
  assertDemoSeedTarget(process.env.DATABASE_URL,process.env.SEED_DEMO_CONFIRM);
  const db=new PrismaClient();
  try {
    await assert.rejects(db.$transaction(async tx=>{
      const bar=await tx.marketDataDaily.findFirstOrThrow();
      await tx.marketDataDaily.update({where:{id:bar.id},data:{dataOrigin:"HISTORICAL"}});
      await assert.rejects(()=>assertPublicDemoDatabase(tx),/refuses/);
      throw new Error("ROLLBACK_VALIDATED");
    }),/ROLLBACK_VALIDATED/);
    await assertPublicDemoDatabase(db);
  } finally { await db.$disconnect(); }
});
