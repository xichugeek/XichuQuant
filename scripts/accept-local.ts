import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { assertDemoSeedTarget } from "../database/prisma/seed-safety";

async function main() {
  assertDemoSeedTarget(process.env.DATABASE_URL, process.env.SEED_DEMO_CONFIRM);
  const api = process.env.ACCEPT_API_URL ?? "http://localhost:5089";
  const web = process.env.ACCEPT_WEB_URL ?? "http://localhost:5088";
  const prisma = new PrismaClient();
  let cookie = ""; let csrf = "";
  async function request(path: string, method = "GET", body?: unknown, expected = 200, authenticated = true) {
    const response = await fetch(`${api}${path}`, { method,
      headers: { "Content-Type":"application/json", Origin:web,
        ...(authenticated ? { Cookie:cookie,"X-CSRF-Token":csrf } : {}) },
      ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(120000),
    });
    assert.ok(response.status === expected || (expected === 200 && response.status === 201), `${method} ${path}: expected ${expected}, got ${response.status}`);
    return response;
  }
  const fingerprint = async () => JSON.stringify({ accounts:await prisma.account.findMany(), positions:await prisma.position.findMany(), trades:await prisma.trade.findMany(),
    externalOrders:await prisma.brokerPaperOrder.findMany(), externalFills:await prisma.brokerPaperExecution.findMany() });
  try {
    const original = await fingerprint();
    await request("/risk/summary","GET",undefined,401,false);
    const login = await request("/auth/login","POST",{username:"admin",password:process.env.SEED_ADMIN_PASSWORD},200,false);
    const result = await login.json() as {csrfToken:string}; csrf=result.csrfToken;
    cookie=login.headers.getSetCookie().map(item=>item.split(";")[0]).join("; ");
    assert.ok(cookie && csrf);
    await request("/auth/session");
    const page = await fetch(process.env.ACCEPT_WEB_FETCH_URL ?? web,{headers:{Cookie:cookie}});
    assert.equal(page.status,200); assert.match(await page.text(),/DLA2/);
    const denied = await fetch(`${api}/backtests/run`,{method:"POST",headers:{Cookie:cookie,Origin:web,"Content-Type":"application/json"},body:"{}"});
    assert.equal(denied.status,403,"Mutation without CSRF must fail");
    if (process.env.PUBLIC_DEMO_READ_ONLY === "true") {
      for (const path of ["/imports/preview","/backtests/run","/paper-trading/accounts","/broker-sync/run","/paper-execution/proposals"]) {
        await request(path,"POST",{},403);
      }
      assert.equal(await fingerprint(),original);
      console.log("PASS: public Demo authenticated reads and all tested mutations refused; business/external ledgers unchanged.");
      return;
    }
    const strategies = await (await request("/strategies")).json() as {id:string;code:string}[];
    const strategy = strategies.find(item=>item.code === "BUY_AND_HOLD_AAPL"); assert.ok(strategy);
    const backtest = await (await request("/backtests/run","POST",{strategyId:strategy.id,symbol:"AAPL",startDate:"2025-01-02",endDate:"2025-06-30",accountId:"account-demo",marketDataSource:"SEED_V1_3"})).json() as {id:string;status:string};
    assert.equal(backtest.status,"COMPLETED");
    const account = await (await request("/paper-trading/accounts","POST",{name:"SYNTHETIC installation acceptance",initialCapital:20000})).json() as {id:string};
    const deployment = await (await request("/paper-trading/deployments","POST",{strategyId:strategy.id,paperAccountId:account.id,name:"SYNTHETIC local acceptance",capitalAllocation:2000,maxPositionPercent:15,stopLossCondition:"Exit after a 3% fall from entry",exitCondition:"Exit after 20 trading days"})).json() as {id:string};
    await request(`/paper-trading/deployments/${deployment.id}/status`,"POST",{action:"START"});
    const run = await (await request(`/paper-trading/deployments/${deployment.id}/run`,"POST",{symbol:"AAPL",signalTradeDate:"2025-06-10"})).json() as {id:string;orders:{id:string}[]};
    assert.ok(run.orders.length > 0,"Internal Paper must produce an order under the existing risk rules");
    await request("/paper-trading/orders/process","POST",{});
    const fills = await prisma.paperFill.findMany({where:{paperOrder:{paperAccountId:account.id}}});
    assert.ok(fills.length > 0,"Internal Paper must actually fill, not only return an HTTP success");
    const second = await (await request(`/paper-trading/deployments/${deployment.id}/run`,"POST",{symbol:"AAPL",signalTradeDate:"2025-06-10"})).json() as {id:string;idempotent:boolean};
    await request("/paper-trading/orders/process","POST",{});
    assert.equal(second.id,run.id); assert.equal(second.idempotent,true);
    assert.equal(await prisma.paperFill.count({where:{paperOrder:{paperAccountId:account.id}}}),fills.length);
    assert.equal(await fingerprint(),original,"Internal execution must not change ordinary or external broker ledgers");
    await request("/auth/logout","POST",{});
    await request("/auth/session","GET",undefined,401);
    console.log("PASS: authentication/CSRF/logout, real SSR data, historical backtest, internal Paper fill/idempotency and ledger isolation.");
  } finally { await prisma.$disconnect(); }
}
void main().catch(error=>{console.error(error instanceof Error ? error.message : "Local acceptance failed");process.exitCode=1;});
