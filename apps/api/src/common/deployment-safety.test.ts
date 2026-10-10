import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicDemoConfiguration, publicDemoMethodAllowed } from "./deployment-safety";
import { ProductionSecurityMiddleware } from "./production-security.middleware";

const safe = { PUBLIC_DEMO_READ_ONLY: "true", NODE_ENV: "production", XICHURISK_DATA_MODE: "DEMO",
  DATABASE_URL: "sqlserver://sqlserver:1433;database=XichuQuantDemo_test;user=example;password=synthetic-not-a-secret;",
  BROKER_CONNECTOR_MODE: "OFFLINE", BROKER_CONNECTOR_ENVIRONMENT: "DISABLED", IBKR_TWS_API_READ_ONLY: "true" };
test("Public Demo refuses business databases, nonproduction and external credentials", () => {
  assert.doesNotThrow(() => assertPublicDemoConfiguration(safe));
  for (const patch of [{ NODE_ENV: "development" }, { XICHURISK_DATA_MODE: "UNKNOWN" }, { DATABASE_URL: "sqlserver://host:1433;database=BusinessDb;" },
    { DATABASE_URL: "sqlserver://host:1433;database=XichuRiskDemo_original;" },
    { DATABASE_URL: `${safe.DATABASE_URL}database=BusinessDb;` }, { BROKER_CONNECTOR_MODE: "IBKR_PAPER" },
    { IBKR_PAPER_ACCOUNT_ID: "synthetic-account" }, { MARKET_DATA_HTTP_BASE_URL: "https://example.invalid" }, { IBKR_TWS_API_READ_ONLY: "false" }]) {
    assert.throws(() => assertPublicDemoConfiguration({ ...safe, ...patch }));
  }
});
test("Public Demo rejects upload, broker, compute and configuration mutations", () => {
  for (const path of ["/imports/preview", "/backtests/run", "/paper-execution/orders", "/paper-trading/accounts", "/risk-rules/one", "/broker-sync/run"]) {
    for (const method of ["POST", "PATCH", "DELETE"]) assert.equal(publicDemoMethodAllowed(method, path), false);
  }
  assert.equal(publicDemoMethodAllowed("POST", "/auth/login"), true);
  assert.equal(publicDemoMethodAllowed("POST", "/auth/logout"), true);
  assert.equal(publicDemoMethodAllowed("GET", "/risk/summary"), true);
});
test("Read-only middleware rejects before reaching database or controller, even with a wrong development flag", async () => {
  let status=0; let next=false;
  const middleware = new ProductionSecurityMiddleware({ get: (key: string, fallback: unknown) => key === "PUBLIC_DEMO_READ_ONLY" ? "true" : fallback } as never, {} as never);
  await middleware.use({ method:"POST", path:"/backtests/run", headers:{}, header:()=>undefined, socket:{} } as never,
    { setHeader:()=>undefined, status:(value:number)=>{status=value;return {json:()=>undefined};} } as never, ()=>{next=true;});
  assert.equal(status,403); assert.equal(next,false);
});
test("Private container health can run without spoofing HTTPS or creating a session", async () => {
  let next=false;
  const middleware = new ProductionSecurityMiddleware({ get: (key:string, fallback:unknown) => key === "NODE_ENV" ? "production" : fallback } as never, {} as never);
  await middleware.use({ method:"GET", path:"/", originalUrl:"/health?probe=1", headers:{}, header:()=>undefined, socket:{} } as never,
    { setHeader:()=>undefined } as never, ()=>{next=true;});
  assert.equal(next,true);
});

test("Mounted production login reaches auth controller while protected routes still require a session", async () => {
  const middleware = new ProductionSecurityMiddleware({ get: (key:string, fallback:unknown) =>
    ({ NODE_ENV:"production", REQUIRE_HTTPS:"false", PUBLIC_DEMO_READ_ONLY:"true" } as Record<string,string>)[key] ?? fallback } as never, {} as never);
  let next=false; let status=0;
  const response = { setHeader:()=>undefined, status:(value:number)=>{status=value;return {json:()=>undefined};} };
  const base = { path:"/", headers:{}, header:(key:string)=>key === "origin" ? "http://localhost:5088" : undefined, socket:{} };
  await middleware.use({ ...base, method:"POST", originalUrl:"/auth/login" } as never, response as never, ()=>{next=true;});
  assert.equal(next,true);
  next=false;
  await middleware.use({ ...base, method:"GET", originalUrl:"/risk/summary" } as never, response as never, ()=>{next=true;});
  assert.equal(next,false); assert.equal(status,401);
});
