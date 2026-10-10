import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateLedgerIntegrity,
  evidenceChecksum,
  externalCertificationStatus,
  fixtureCanBeExternal,
  linuxCertificationStatus,
  percentile,
  READINESS_STATUSES,
  releaseCertificationStatus,
  sanitizeEvidence,
  soakContinuity,
  soakProgress,
} from "./certification.rules";

test("外部 IBKR 环境缺失时必须 BLOCKED", () => {
  const result = externalCertificationStatus({accountAllowlisted:false,accountTypePaper:false,apiEnabled:false,explicitOrderAuthorization:false,gatewayRunning:false,killSwitchNormal:true,paperSessionAuthenticated:false,runModePaper:false});
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.missing.includes("gatewayRunning"));
});

test("外部前提全部明确满足后才允许进入人工验收", () => {
  const result = externalCertificationStatus({accountAllowlisted:true,accountTypePaper:true,apiEnabled:true,explicitOrderAuthorization:true,gatewayRunning:true,killSwitchNormal:true,paperSessionAuthenticated:true,runModePaper:true});
  assert.equal(result.status, "READY_FOR_MANUAL_TEST");
});

test("Fixture 和 NOT_EXTERNAL 永远不能标记为外部证据", () => {
  assert.equal(fixtureCanBeExternal("V1_9_FIXTURE", "123"), false);
  assert.equal(fixtureCanBeExternal("NOT_EXTERNAL", "123"), false);
  assert.equal(fixtureCanBeExternal("RUNTIME_EXTERNAL", "FIXTURE-1"), false);
  assert.equal(fixtureCanBeExternal("RUNTIME_EXTERNAL", "PAPER-1"), true);
});

test("非 Linux 或无 Docker 时 Linux 认证必须 BLOCKED", () => {
  assert.equal(linuxCertificationStatus({composeAvailable:false,dockerAvailable:false,isLinux:false}).status, "BLOCKED");
});

test("Soak Test 未达到 72 小时只能保持 RUNNING", () => {
  const start = new Date("2026-07-01T00:00:00Z");
  assert.equal(soakProgress(start, 72, new Date("2026-07-03T23:59:00Z")).status, "RUNNING");
  assert.equal(soakProgress(start, 72, new Date("2026-07-04T00:00:00Z")).status, "ELIGIBLE_FOR_REVIEW");
});

test("Soak Test 不允许把关机或采样空洞计入连续运行时长", () => {
  const start = new Date("2026-07-01T00:00:00Z");
  assert.equal(
    soakContinuity(start, [new Date("2026-07-01T00:05:00Z")], new Date("2026-07-01T00:09:00Z")).continuous,
    true,
  );
  assert.equal(
    soakContinuity(start, [new Date("2026-07-01T00:05:00Z")], new Date("2026-07-01T00:20:01Z")).continuous,
    false,
  );
});

test("P95 与 P99 使用真实样本排序", () => {
  const values = Array.from({length:100},(_,index)=>index+1);
  assert.equal(percentile(values, .95),95);
  assert.equal(percentile(values, .99),99);
});

test("十项账本不变量全部正常时通过", () => {
  const checks=evaluateLedgerIntegrity({cashEquityDifference:0,criticalReconciliationDifferences:0,duplicateExecutionIds:0,isolationViolations:0,orphanCommissions:0,orphanExecutions:0,overfilledOrders:0,positionQuantityDifferences:0,postCancelExecutions:0,submissionUnknownRetries:0});
  assert.equal(checks.length,10); assert.ok(checks.every(item=>item.status==="PASSED"));
});

test("重复成交、过量成交与重大对账差异均为 CRITICAL 失败", () => {
  const checks=evaluateLedgerIntegrity({cashEquityDifference:0,criticalReconciliationDifferences:1,duplicateExecutionIds:1,isolationViolations:0,orphanCommissions:0,orphanExecutions:0,overfilledOrders:1,positionQuantityDifferences:0,postCancelExecutions:0,submissionUnknownRetries:0});
  assert.equal(checks.filter(item=>item.status==="FAILED").length,3);
});

test("撤单后成交标记警告而非伪装正常", () => {
  const check=evaluateLedgerIntegrity({cashEquityDifference:0,criticalReconciliationDifferences:0,duplicateExecutionIds:0,isolationViolations:0,orphanCommissions:0,orphanExecutions:0,overfilledOrders:0,positionQuantityDifferences:0,postCancelExecutions:1,submissionUnknownRetries:0}).find(item=>item.code==="CANCEL_NO_NEW_EXECUTION");
  assert.equal(check?.status,"WARNING");
});

test("证据自动脱敏密码、Token、Cookie 与完整账户号", () => {
  const value=sanitizeEvidence({password:"x",nested:{accessToken:"y"},account:"DU1234567",text:"authorization=abc"}) as Record<string,unknown>;
  assert.equal(value.password,"[REDACTED]");
  assert.doesNotMatch(JSON.stringify(value),/DU1234567|abc|"x"|"y"/);
});

test("脱敏证据校验和稳定", () => {
  assert.equal(evidenceChecksum({token:"one",value:1}),evidenceChecksum({token:"two",value:1}));
});

test("系统准备度只允许四个非 Live 状态", () => {
  assert.deepEqual(READINESS_STATUSES,["NOT_READY","OBSERVING","TECHNICALLY_READY","RISK_REVIEW_REQUIRED"]);
  assert.equal(READINESS_STATUSES.includes("LIVE_READY" as never),false);
});

test("任一外部认证未通过时只能部分完成且 NOT_READY", () => {
  const result=releaseCertificationStatus({external:"BLOCKED",faults:"PASSED",ledger:"PASSED",linux:"BLOCKED",soak:"RUNNING"});
  assert.deepEqual(result,{readinessStatus:"NOT_READY",status:"PARTIALLY_COMPLETED"});
});

test("所有真实认证通过后仍只进入风险复核", () => {
  const result=releaseCertificationStatus({external:"PASSED",faults:"PASSED",ledger:"PASSED",linux:"PASSED",soak:"PASSED"});
  assert.deepEqual(result,{readinessStatus:"RISK_REVIEW_REQUIRED",status:"COMPLETED"});
});
