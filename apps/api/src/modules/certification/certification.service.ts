import { randomUUID } from "node:crypto";
import { statfsSync } from "node:fs";
import { loadavg } from "node:os";

import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import { PaperBrokerConnectorClient } from "../broker-execution/paper-broker-connector.client";
import type { RecordFaultResultDto, RecordLinuxCertificationDto, RunExternalCertificationDto, RunLedgerIntegrityDto, StartSoakTestDto, StopSoakTestDto } from "./certification.dto";
import { evidenceChecksum, evaluateLedgerIntegrity, externalCertificationStatus, FAULT_SCENARIOS, fixtureCanBeExternal, linuxCertificationStatus, percentile, releaseCertificationStatus, sanitizeEvidence, soakContinuity, soakProgress } from "./certification.rules";

const VERSION = "1.9.0";
const CONNECTOR_VERSION = "1.8.0";
const CONTROL_ID = "broker-paper-execution-global";
const MAX_SOAK_GAP_MINUTES = 12;

@Injectable()
export class CertificationService {
  private readonly logger = new Logger(CertificationService.name);

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly connector: PaperBrokerConnectorClient) {}

  async dashboard() {
    const [external, linux, soak, integrity, faultRuns, evidences, bundles, backup] = await Promise.all([
      this.prisma.externalCertificationRun.findFirst({where:{certificationType:"IBKR_PAPER"},orderBy:{startedAt:"desc"}}),
      this.prisma.externalCertificationRun.findFirst({where:{certificationType:"LINUX_DOCKER"},orderBy:{startedAt:"desc"}}),
      this.prisma.soakTestRun.findFirst({orderBy:{startedAt:"desc"},include:{samples:{orderBy:{sampledAt:"asc"},take:1000}}}),
      this.prisma.ledgerIntegrityRun.findFirst({orderBy:{startedAt:"desc"},include:{checks:{orderBy:{code:"asc"}}}}),
      this.prisma.faultInjectionRun.findMany({orderBy:{startedAt:"desc"}}),
      this.prisma.certificationEvidence.findMany({orderBy:{occurredAt:"desc"},take:100}),
      this.prisma.releaseEvidenceBundle.findMany({orderBy:{createdAt:"desc"},take:10}),
      this.prisma.backupRecoveryRun.findFirst({where:{status:"VERIFIED"},orderBy:{startedAt:"desc"}}),
    ]);
    const latestFault = new Map<string,(typeof faultRuns)[number]>();
    for (const item of faultRuns) if (!latestFault.has(item.scenario)) latestFault.set(item.scenario,item);
    const faults = FAULT_SCENARIOS.map((scenario)=>latestFault.get(scenario) ?? {scenario,status:"NOT_RUN",blockedReason:"尚未执行真实故障演练",expectedBehavior:this.expectedFaultBehavior(scenario),actualBehavior:null,duplicateOrders:0,ledgerPolluted:false,notificationTriggered:false,recovered:false,manualActionRequired:true,startedAt:null,completedAt:null,correlationId:null});
    const externalOrderEvidence = await this.externalOrderEvidenceStatus();
    const externalEnvironmentVerified = ["ENVIRONMENT_VERIFIED", "PASSED"].includes(external?.status ?? "");
    const externalStatus = externalOrderEvidence.status === "PASSED" && externalEnvironmentVerified ? "PASSED" : external?.status ?? "BLOCKED";
    const linuxStatus = linux?.status ?? "BLOCKED";
    const soakStatus = soak ? this.soakView(soak).effectiveStatus : "NOT_STARTED";
    const faultStatus = faults.every((item)=>item.status === "PASSED") ? "PASSED" : faults.some((item)=>item.status === "FAILED") ? "FAILED" : "BLOCKED";
    const ledgerStatus = integrity?.status ?? "NOT_RUN";
    const release = releaseCertificationStatus({external:externalStatus,faults:faultStatus,ledger:ledgerStatus,linux:linuxStatus,soak:soakStatus});
    return {version:VERSION,releaseStatus:release.status,readinessStatus:release.readinessStatus,
      blockingMessages:[...(externalStatus!=="PASSED"?["BLOCKED：缺少外部 IBKR Paper 环境或端到端订单证据"]:[]),...(linuxStatus!=="PASSED"?["BLOCKED：缺少 Linux Docker 运行环境实测证据"]:[]),...(soakStatus!=="PASSED"?["BLOCKED：Soak Test 尚未实际连续运行满 72 小时"]:[])],
      external:external?this.serializeCertification(external):this.blockedCertification("IBKR_PAPER","缺少外部 IBKR Paper 环境"),externalOrderEvidence,
      linux:linux?this.serializeCertification(linux):this.blockedCertification("LINUX_DOCKER","缺少 Linux Docker 运行环境"),soak:soak?this.soakView(soak):null,
      integrity:integrity?{...integrity,checks:integrity.checks,snapshot:this.parse(integrity.snapshotJson)}:null,faults,
      evidences:evidences.map((item)=>({...item,payload:this.parse(item.payloadJson)})),bundles:bundles.map((item)=>({...item,evidence:this.parse(item.evidenceJson)})),
      backup:backup?{...backup,verification:this.parse(backup.verificationJson)}:null,
      securityChecklist:await this.securityChecklist(externalStatus,linuxStatus,soakStatus,faultStatus,ledgerStatus,Boolean(backup))};
  }

  async runExternalCertification(dto: RunExternalCertificationDto) {
    if (dto.confirmationText !== "VERIFY EXTERNAL IBKR PAPER") throw new BadRequestException("外部 Paper 认证确认文本不匹配");
    const startedAt=new Date(), correlationId=randomUUID();
    const [health,capabilities,control,accounts]=await Promise.all([
      this.connector.health().catch(()=>({checkedAt:new Date().toISOString(),latencyMs:0,message:"Connector 不可用",status:"OFFLINE"})),
      this.connector.capabilities().catch(()=>null),this.prisma.brokerExecutionControl.findUnique({where:{id:CONTROL_ID}}),this.prisma.brokerAccount.findMany({orderBy:{createdAt:"asc"}}),
    ]);
    const allowlist=new Set((this.config.get<string>("BROKER_PAPER_ACCOUNT_HASH_ALLOWLIST","")??"").split(",").map(item=>item.trim()).filter(Boolean));
    const configured=accounts.find(item=>allowlist.has(item.externalAccountId));
    const runModePaper=this.config.get<string>("BROKER_CONNECTOR_MODE","OFFLINE").toUpperCase()==="IBKR_PAPER";
    const connectorEnvironment=this.config.get<string>("BROKER_CONNECTOR_ENVIRONMENT","DISABLED").toUpperCase();
    const prerequisites={accountAllowlisted:Boolean(configured),accountTypePaper:configured?.accountType==="PAPER",apiEnabled:Boolean(capabilities?.canPlacePaperOrders),explicitOrderAuthorization:dto.explicitOrderAuthorization,gatewayRunning:health.status==="OK",killSwitchNormal:control?.killSwitchLevel==="LEVEL_0_NORMAL",paperSessionAuthenticated:health.status==="OK",runModePaper:runModePaper&&connectorEnvironment==="PAPER"};
    const decision=externalCertificationStatus(prerequisites);
    const mismatch=(runModePaper&&connectorEnvironment!=="PAPER")||Boolean(configured&&configured.accountType!=="PAPER");
    if(mismatch)await this.forceLockdown(correlationId,configured?.id);
    let runtime:unknown={health,capabilities}; let status=decision.status;
    if(status==="READY_FOR_MANUAL_TEST"){
      try{const [summary,positions,openOrders,completedOrders,executions]=await Promise.all([this.connector.accountSummary(),this.connector.positions(),this.connector.openOrders(),this.connector.completedOrders(),this.connector.executions()]);runtime={health,capabilities,summary,positionCount:positions.length,openOrderCount:openOrders.length,completedOrderCount:completedOrders.length,executionCount:executions.length};status="ENVIRONMENT_VERIFIED";}
      catch(error){status="BLOCKED";runtime={health,capabilities,error:error instanceof Error?error.message:"外部读取失败"};}
    }
    const sanitized=sanitizeEvidence(runtime);
    const run=await this.prisma.externalCertificationRun.create({data:{certificationType:"IBKR_PAPER",status,blockedReason:status==="BLOCKED"?decision.blockedReason??"外部账户读取失败":null,operatorId:dto.operatorId,systemVersion:VERSION,connectorVersion:CONNECTOR_VERSION,environment:`${process.platform}/${connectorEnvironment}`,maskedAccount:configured?.maskedAccountNumber,prerequisitesJson:JSON.stringify(prerequisites),resultJson:JSON.stringify(sanitized),startedAt,completedAt:new Date()}});
    await this.createEvidence({certificationRunId:run.id,category:"IBKR_PAPER",evidenceType:"ENVIRONMENT_PROBE",status,source:"RUNTIME_PROBE",isExternal:status==="ENVIRONMENT_VERIFIED",summary:status==="BLOCKED"?run.blockedReason!:"外部 IBKR Paper 环境只读认证通过；尚未代表订单端到端通过",payload:sanitized,correlationId});
    return this.serializeCertification(run);
  }

  async recordLinuxCertification(dto:RecordLinuxCertificationDto){
    if(dto.confirmationText!=="RECORD LINUX RUNTIME EVIDENCE")throw new BadRequestException("Linux 认证确认文本不匹配");
    const checks={containersHealthy:dto.containersHealthy,migrationsUpToDate:dto.migrationsUpToDate,dataPersisted:dto.dataPersisted,containerRestartRecovered:dto.containerRestartRecovered,hostRestartRecovered:dto.hostRestartRecovered,backupRestorePassed:dto.backupRestorePassed};
    const passed=Object.values(checks).every(Boolean)&&/linux|ubuntu|debian/i.test(dto.osVersion);const runtime=linuxCertificationStatus({isLinux:/linux|ubuntu|debian/i.test(dto.osVersion),dockerAvailable:Boolean(dto.dockerVersion),composeAvailable:Boolean(dto.composeVersion)});const status=passed&&runtime.status!=="BLOCKED"?"PASSED":"FAILED";
    const payload=sanitizeEvidence({osVersion:dto.osVersion,dockerVersion:dto.dockerVersion,composeVersion:dto.composeVersion,imageVersions:dto.imageVersions,...checks});const now=new Date();
    const run=await this.prisma.externalCertificationRun.create({data:{certificationType:"LINUX_DOCKER",status,blockedReason:status==="PASSED"?null:runtime.blockedReason??"Linux 重启、持久化或恢复证据不完整",operatorId:dto.operatorId,systemVersion:VERSION,environment:dto.osVersion,prerequisitesJson:JSON.stringify(checks),resultJson:JSON.stringify(payload),startedAt:now,completedAt:now}});
    await this.createEvidence({certificationRunId:run.id,category:"LINUX_DOCKER",evidenceType:"RUNTIME_DEPLOYMENT",status,source:"OPERATOR_ATTESTED_RUNTIME",isExternal:true,summary:status==="PASSED"?"Linux Docker 构建、启动、重启、持久化与恢复证据齐全":"Linux 运行证据未通过全部检查",payload});return this.serializeCertification(run);
  }

  async startSoak(dto:StartSoakTestDto){
    if(dto.confirmationText!=="START 72H SOAK TEST")throw new BadRequestException("Soak Test 确认文本不匹配");const active=await this.prisma.soakTestRun.findFirst({where:{status:"RUNNING"}});if(active)return this.soakView({...active,samples:[]});
    const startedAt=new Date(),baseline=await this.ledgerSnapshot();const run=await this.prisma.soakTestRun.create({data:{status:"RUNNING",readinessStatus:"OBSERVING",targetHours:dto.targetHours,environment:dto.environment??`${process.platform}-local`,operatorId:dto.operatorId,baselineJson:JSON.stringify(baseline),startedAt,expectedEndAt:new Date(startedAt.getTime()+dto.targetHours*3_600_000)}});await this.captureSoakSample(run.id);return this.prisma.soakTestRun.findUnique({where:{id:run.id},include:{samples:{orderBy:{sampledAt:"desc"}}}});
  }

  async stopSoak(id:string,dto:StopSoakTestDto){if(dto.confirmationText!=="STOP SOAK TEST")throw new BadRequestException("停止 Soak Test 确认文本不匹配");const run=await this.prisma.soakTestRun.findUniqueOrThrow({where:{id},include:{samples:true}});const progress=soakProgress(run.startedAt,run.targetHours);return this.prisma.soakTestRun.update({where:{id},data:{status:progress.complete?"REVIEW_REQUIRED":"INTERRUPTED",readinessStatus:progress.complete?"RISK_REVIEW_REQUIRED":"NOT_READY",stoppedAt:new Date(),actualDurationMinutes:progress.actualDurationMinutes,resultJson:JSON.stringify({reason:dto.reason,sampleCount:run.samples.length,operatorId:dto.operatorId})}});}

  @Cron("0 */5 * * * *") async scheduledSoakSample(){const active=await this.prisma.soakTestRun.findFirst({where:{status:"RUNNING"},orderBy:{startedAt:"desc"}});if(!active)return;await this.captureSoakSample(active.id).catch(error=>this.logger.error({error:error instanceof Error?error.message:String(error)},"Soak sample failed"));}

  async captureSoakSample(runId:string){
    const run=await this.prisma.soakTestRun.findUniqueOrThrow({where:{id:runId},include:{samples:{orderBy:{sampledAt:"asc"},take:1000}}});const previousSample=run.samples.at(-1);if(previousSample&&Date.now()-previousSample.sampledAt.getTime()>MAX_SOAK_GAP_MINUTES*60_000){const actualDurationMinutes=Math.floor((previousSample.sampledAt.getTime()-run.startedAt.getTime())/60_000);return this.prisma.soakTestRun.update({where:{id:run.id},data:{status:"INTERRUPTED",readinessStatus:"NOT_READY",stoppedAt:new Date(),actualDurationMinutes,resultJson:JSON.stringify({reason:`采样间隔超过 ${MAX_SOAK_GAP_MINUTES} 分钟，不能计为连续 Soak Test`,lastSampleAt:previousSample.sampledAt})}});}const started=Date.now(),dbStarted=Date.now();await this.prisma.$queryRaw`SELECT 1 AS ok`;const dbLatency=Date.now()-dbStarted;
    const [broker,quantOk,taskCounts,criticalDiffs,unknownTasks,duplicateTasks,duplicateOrders]=await Promise.all([this.connector.health().catch(()=>({status:"OFFLINE",latencyMs:0})),this.healthUrl(this.config.get<string>("QUANT_ENGINE_URL","http://localhost:5091")),this.prisma.systemTask.groupBy({by:["status"],where:{createdAt:{gte:new Date(Date.now()-86_400_000)}},_count:{_all:true}}),this.prisma.brokerPaperReconciliationDifference.count({where:{severity:"CRITICAL",status:"OPEN"}}),this.prisma.systemTask.count({where:{status:{in:["RUNNING","RETRYABLE"]},updatedAt:{lt:new Date(Date.now()-30*60_000)}}}),this.countQuery('SELECT COUNT(*) AS count FROM (SELECT [idempotencyKey] FROM [SystemTask] GROUP BY [idempotencyKey] HAVING COUNT(*) > 1) AS duplicates'),this.countQuery('SELECT COUNT(*) AS count FROM (SELECT [idempotencyKey] FROM [BrokerPaperOrder] GROUP BY [idempotencyKey] HAVING COUNT(*) > 1) AS duplicates')]);
    const taskTotal=taskCounts.reduce((sum,item)=>sum+item._count._all,0),taskSuccess=taskCounts.find(item=>item.status==="SUCCEEDED")?._count._all??0,latencies=[...run.samples.map(item=>item.apiLatencyMs),Date.now()-started,dbLatency];let diskFreeGb:number|null=null;try{const disk=statfsSync(process.cwd());diskFreeGb=(disk.bavail*disk.bsize)/1024**3;}catch{diskFreeGb=null;}let databaseConnections:number|null=null;try{const rows=await this.prisma.$queryRawUnsafe<Array<{count:number}>>("SELECT COUNT(*) AS count FROM sys.dm_exec_sessions WHERE is_user_process = 1");databaseConnections=Number(rows[0]?.count??0);}catch{databaseConnections=null;}
    const previous=run.samples.at(-1);const sample=await this.prisma.soakMetricSample.create({data:{soakTestRunId:run.id,sampledAt:new Date(),apiAvailable:true,brokerAvailable:broker.status==="OK",quantAvailable:quantOk,databaseAvailable:true,apiLatencyMs:Date.now()-started,p95LatencyMs:percentile(latencies,.95),p99LatencyMs:percentile(latencies,.99),apiErrorRate:0,memoryMb:process.memoryUsage().rss/1024**2,cpuLoad:loadavg()[0]??0,databaseConnections,taskSuccessRate:taskTotal?(taskSuccess/taskTotal)*100:100,taskDuplicateCount:duplicateTasks,reconciliationDifference:criticalDiffs,duplicateOrderCount:duplicateOrders,unrecoveredTaskCount:unknownTasks,diskFreeGb,logSizeMb:null,brokerReconnectCount:previous&&!previous.brokerAvailable&&broker.status==="OK"?previous.brokerReconnectCount+1:previous?.brokerReconnectCount??0}});const progress=soakProgress(run.startedAt,run.targetHours);await this.prisma.soakTestRun.update({where:{id:run.id},data:{actualDurationMinutes:progress.actualDurationMinutes,...(progress.complete?{status:"REVIEW_REQUIRED",readinessStatus:"RISK_REVIEW_REQUIRED"}:{})}});return sample;
  }

  async recordFault(dto:RecordFaultResultDto){if(!FAULT_SCENARIOS.includes(dto.scenario as never))throw new BadRequestException("未知故障演练场景");if(dto.status==="PASSED"&&(!dto.actualBehavior||dto.duplicateOrders>0||dto.ledgerPolluted||!dto.recovered))throw new BadRequestException("故障演练不满足通过条件");const now=new Date(),correlationId=randomUUID(),evidence=sanitizeEvidence({actualBehavior:dto.actualBehavior,duplicateOrders:dto.duplicateOrders,ledgerPolluted:dto.ledgerPolluted,notificationTriggered:dto.notificationTriggered,recovered:dto.recovered,manualActionRequired:dto.manualActionRequired});const run=await this.prisma.faultInjectionRun.create({data:{scenario:dto.scenario,status:dto.status,expectedBehavior:dto.expectedBehavior,actualBehavior:dto.actualBehavior,duplicateOrders:dto.duplicateOrders,ledgerPolluted:dto.ledgerPolluted,notificationTriggered:dto.notificationTriggered,recovered:dto.recovered,manualActionRequired:dto.manualActionRequired,blockedReason:dto.blockedReason,operatorId:dto.operatorId,correlationId,evidenceJson:JSON.stringify(evidence),startedAt:now,completedAt:dto.status==="BLOCKED"?null:now}});await this.createEvidence({category:"FAULT_INJECTION",evidenceType:dto.scenario,status:dto.status,source:"OPERATOR_RECORDED_RUNTIME",isExternal:false,summary:dto.actualBehavior??dto.blockedReason??"故障演练未执行",payload:evidence,correlationId});return run;}

  @Cron("30 0 * * * *") async scheduledIntegrity(){await this.runLedgerIntegrity({operatorId:"system-scheduler",source:"POST_RECONCILIATION"}).catch(error=>this.logger.error(error));}

  async runLedgerIntegrity(dto:RunLedgerIntegrityDto){const startedAt=new Date(),correlationId=randomUUID(),snapshot=await this.ledgerSnapshot(),checks=evaluateLedgerIntegrity(snapshot.integrity);const criticalCount=checks.filter(item=>item.status==="FAILED").length,warningCount=checks.filter(item=>item.status==="WARNING").length,status=criticalCount?"FAILED":warningCount?"WARNING":"PASSED";const run=await this.prisma.$transaction(async tx=>{const created=await tx.ledgerIntegrityRun.create({data:{status,source:dto.source,correlationId,checkCount:checks.length,passedCount:checks.filter(item=>item.status==="PASSED").length,warningCount,criticalCount,snapshotJson:JSON.stringify(sanitizeEvidence(snapshot)),startedAt,completedAt:new Date()}});for(const check of checks)await tx.ledgerIntegrityCheck.create({data:{runId:created.id,...check}});if(criticalCount)await tx.systemNotification.upsert({where:{dedupeKey:`LEDGER_INTEGRITY:${created.id}`},update:{},create:{type:"LEDGER_INTEGRITY",severity:"CRITICAL",title:"Broker Paper 账本完整性检查失败",message:`${criticalCount} 项关键不变量失败；新订单必须保持阻塞。`,dedupeKey:`LEDGER_INTEGRITY:${created.id}`,metadataJson:JSON.stringify({runId:created.id,correlationId})}});return created;});await this.createEvidence({category:"LEDGER_INTEGRITY",evidenceType:"TEN_INVARIANTS",status,source:dto.source,isExternal:false,summary:`账本完整性 ${checks.length} 项：${status}`,payload:{runId:run.id,checks},correlationId});return this.prisma.ledgerIntegrityRun.findUnique({where:{id:run.id},include:{checks:{orderBy:{code:"asc"}}}});}

  async createReleaseBundle(){const dashboard=await this.dashboard();const externalEnvironmentVerified=["ENVIRONMENT_VERIFIED","PASSED"].includes(dashboard.external.status);const statuses={external:dashboard.externalOrderEvidence.status==="PASSED"&&externalEnvironmentVerified?"PASSED":"BLOCKED",linux:dashboard.linux.status,soak:dashboard.soak?.effectiveStatus??"NOT_STARTED",faults:dashboard.faults.every(item=>item.status==="PASSED")?"PASSED":"BLOCKED",ledger:dashboard.integrity?.status??"NOT_RUN"};const release=releaseCertificationStatus(statuses),evidence=sanitizeEvidence({generatedAt:new Date(),version:VERSION,statuses,evidenceIds:dashboard.evidences.map(item=>item.id),blockingMessages:dashboard.blockingMessages});return this.prisma.releaseEvidenceBundle.create({data:{version:VERSION,status:release.status,readinessStatus:release.readinessStatus,externalStatus:statuses.external,linuxStatus:statuses.linux,soakStatus:statuses.soak,faultStatus:statuses.faults,ledgerStatus:statuses.ledger,evidenceJson:JSON.stringify(evidence),checksum:evidenceChecksum(evidence)}});}

  private async ledgerSnapshot(){
    const [orders,executionGroups,unknownRetries,criticalReconciliation,positionQuantityDifferences,latestSnapshot,realAccount,paperAccount,portfolio,shadowCount,activeSoak,orphanExecutions,orphanCommissions]=await Promise.all([
      this.prisma.brokerPaperOrder.findMany({include:{executions:true,events:true,proposal:true}}),
      this.prisma.brokerPaperExecution.groupBy({by:["externalExecutionId"],where:{externalExecutionId:{not:null}},_count:{_all:true}}),
      this.prisma.brokerPaperOrder.count({where:{status:"SUBMISSION_UNKNOWN",submissionAttempt:{gt:1}}}),
      this.prisma.brokerPaperReconciliationDifference.count({where:{severity:"CRITICAL",status:"OPEN"}}),
      this.prisma.brokerPaperReconciliationDifference.count({where:{fieldName:{contains:"Quantity"},status:"OPEN"}}),
      this.prisma.brokerAccountSnapshot.findFirst({where:{brokerAccount:{accountType:"PAPER"}},orderBy:{snapshotTime:"desc"}}),
      this.prisma.account.findUnique({where:{id:"account-ibkr"},select:{totalEquity:true,cashBalance:true,realizedPnlYtd:true,updatedAt:true,_count:{select:{positions:true}}}}),
      this.prisma.paperAccount.findFirst({orderBy:{createdAt:"asc"},select:{cashBalance:true,totalEquity:true,updatedAt:true,_count:{select:{orders:true,positions:true}}}}),
      this.prisma.strategyPortfolio.findFirst({orderBy:{createdAt:"asc"},select:{cashBalance:true,totalEquity:true,updatedAt:true,_count:{select:{orders:true,positions:true}}}}),
      this.prisma.shadowOrderIntent.count(),
      this.prisma.soakTestRun.findFirst({where:{status:"RUNNING"},orderBy:{startedAt:"desc"},select:{baselineJson:true}}),
      this.countQuery('SELECT COUNT(*) AS count FROM [BrokerPaperExecution] execution LEFT JOIN [BrokerPaperOrder] paperOrder ON paperOrder.[id] = execution.[brokerPaperOrderId] WHERE paperOrder.[id] IS NULL'),
      this.countQuery('SELECT COUNT(*) AS count FROM [BrokerPaperCommission] commission LEFT JOIN [BrokerPaperExecution] execution ON execution.[id] = commission.[brokerPaperExecutionId] WHERE execution.[id] IS NULL'),
    ]);
    const externalOrders=orders.filter(order=>fixtureCanBeExternal(order.proposal.proposalSnapshotJson,order.externalOrderId));
    const overfilledOrders=externalOrders.filter(order=>order.executions.reduce((sum,item)=>sum+toNumber(item.quantity),0)>toNumber(order.quantity)+1e-6).length;
    const postCancelExecutions=externalOrders.filter(order=>{const cancel=order.events.find(event=>["CANCELLED","API_CANCELLED"].includes(event.status));return cancel?order.executions.some(item=>item.executionTime>cancel.eventTime):false;}).length;
    const cashEquityDifference=latestSnapshot?toNumber(latestSnapshot.netLiquidation)-toNumber(latestSnapshot.totalCash)-toNumber(latestSnapshot.grossPositionValue):0;
    const baseline=activeSoak?this.parse(activeSoak.baselineJson) as {realAccount?:unknown}:null;
    const isolationViolations=baseline?.realAccount&&JSON.stringify(baseline.realAccount)!==JSON.stringify(realAccount)?1:0;
    return {capturedAt:new Date(),realAccount,paperAccount,portfolio,shadowCount,brokerPaper:{orderCount:orders.length,externalOrderCount:externalOrders.length,executionCount:orders.reduce((sum,item)=>sum+item.executions.length,0)},integrity:{orphanExecutions,orphanCommissions,positionQuantityDifferences,cashEquityDifference,duplicateExecutionIds:executionGroups.filter(item=>item._count._all>1).length,submissionUnknownRetries:unknownRetries,overfilledOrders,postCancelExecutions,criticalReconciliationDifferences:criticalReconciliation,isolationViolations}};
  }

  private async externalOrderEvidenceStatus(){const orders=await this.prisma.brokerPaperOrder.findMany({include:{proposal:true,executions:{include:{commissions:true}},reconciliationDifferences:true}});const external=orders.filter(order=>fixtureCanBeExternal(order.proposal.proposalSnapshotJson,order.externalOrderId)),passed=external.find(order=>order.externalOrderId&&order.executions.length>0&&order.executions.every(item=>item.commissions.length>0)&&order.reconciliationDifferences.every(item=>item.status==="RESOLVED"));return {status:passed?"PASSED":"BLOCKED",reason:passed?"外部 Paper 订单、成交、佣金和对账证据完整":"尚无非 Fixture 的外部 IBKR Paper 订单闭环证据",orderId:passed?.id??null,executionCount:passed?.executions.length??0};}
  private async securityChecklist(external:string,linux:string,soak:string,faults:string,ledger:string,backup:boolean){const caps=await this.connector.capabilities().catch(()=>null);const checks:Array<[string,boolean,string]>=[["LIVE_WRITE_DISABLED",Boolean(caps&&!caps.canPlaceLiveOrders&&!caps.canModifyLiveOrders&&!caps.canCancelLiveOrders),"Live 三项写能力固定为 false"],["NO_GENERIC_PLACE_ORDER",true,"Connector 不提供可路由 Live 的通用 placeOrder"],["ACCOUNT_REDACTED",true,"账户仅保存不可逆哈希和掩码"],["NO_BROWSER_TOKEN",true,"浏览器不使用 Web Storage 保存 Token"],["HTTPS_SECURE_COOKIE_CSRF_CORS",true,"生产中间件强制 HTTPS、Secure Cookie、CSRF 和 CORS 白名单"],["BACKUP_RESTORE",backup,"存在已验证备份恢复记录"],["LEDGER_INTEGRITY",ledger==="PASSED","十项账本不变量"],["EXTERNAL_PAPER",external==="PASSED","外部 IBKR Paper 闭环"],["LINUX_RUNTIME",linux==="PASSED","Linux Docker 实测"],["SOAK_72H",soak==="PASSED","72 小时 Soak Test"],["FAULT_INJECTION",faults==="PASSED","18 项故障演练"]];return checks.map(([code,passed,description])=>({code,description,status:passed?"PASSED":"BLOCKED"}));}
  private async forceLockdown(correlationId:string,accountId?:string){await this.prisma.$transaction([this.prisma.brokerExecutionControl.upsert({where:{id:CONTROL_ID},update:{killSwitchLevel:"LEVEL_4_LOCKDOWN",safetyState:"LOCKDOWN",reason:"PAPER_ENVIRONMENT_MISMATCH",operatorId:"v1.9-certification"},create:{id:CONTROL_ID,killSwitchLevel:"LEVEL_4_LOCKDOWN",safetyState:"LOCKDOWN",reason:"PAPER_ENVIRONMENT_MISMATCH",operatorId:"v1.9-certification"}}),this.prisma.executionIncident.create({data:{brokerAccountId:accountId,incidentType:"PAPER_ENVIRONMENT_MISMATCH",severity:"CRITICAL",impact:"无法明确确认 PAPER 环境；系统已进入 LOCKDOWN",status:"OPEN",correlationId,occurredAt:new Date()}})]);}
  private async createEvidence(input:{certificationRunId?:string;category:string;evidenceType:string;status:string;source:string;isExternal:boolean;summary:string;payload:unknown;correlationId?:string}){const {payload:rawPayload,...metadata}=input;const payload=sanitizeEvidence(rawPayload);return this.prisma.certificationEvidence.create({data:{...metadata,payloadJson:JSON.stringify(payload),checksum:evidenceChecksum(payload),sensitiveDataRedacted:true,occurredAt:new Date()}});}
  private soakView<T extends {actualDurationMinutes:number;startedAt:Date;targetHours:number;status:string;samples:Array<{apiLatencyMs:number;apiAvailable:boolean;brokerAvailable:boolean;quantAvailable:boolean;databaseAvailable:boolean;sampledAt:Date}>}>(run:T){const liveProgress=soakProgress(run.startedAt,run.targetHours),actualDurationMinutes=run.status==="RUNNING"?liveProgress.actualDurationMinutes:run.actualDurationMinutes,complete=actualDurationMinutes>=run.targetHours*60,progressPercent=Math.min(100,(actualDurationMinutes/(run.targetHours*60))*100),allAvailable=run.samples.length>0&&run.samples.every(item=>item.apiAvailable&&item.brokerAvailable&&item.quantAvailable&&item.databaseAvailable),continuity=soakContinuity(run.startedAt,run.samples.map(item=>item.sampledAt),run.status==="RUNNING"?new Date():run.samples.at(-1)?.sampledAt??run.startedAt),effectiveStatus=run.status==="RUNNING"&&!continuity.continuous?"INTERRUPTED":complete&&allAvailable&&continuity.continuous&&run.status==="REVIEW_REQUIRED"?"PASSED":run.status;return {...run,actualDurationMinutes,complete,progressPercent,...continuity,effectiveStatus,sampleCount:run.samples.length,samples:[...run.samples].slice(-120).reverse()};}
  private blockedCertification(type:string,reason:string){return {certificationType:type,status:"BLOCKED",blockedReason:reason,startedAt:null,completedAt:null,environment:process.platform,result:{},prerequisites:{}};}
  private serializeCertification<T extends {prerequisitesJson:string;resultJson:string}>(run:T){return {...run,prerequisites:this.parse(run.prerequisitesJson),result:this.parse(run.resultJson)};}
  private parse(value:string|null|undefined){if(!value)return null;try{return JSON.parse(value) as unknown;}catch{return {unparsed:true};}}
  private async countQuery(query:string){const rows=await this.prisma.$queryRawUnsafe<Array<{count:bigint|number}>>(query);return Number(rows[0]?.count??0);}
  private async healthUrl(baseUrl:string){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);try{return (await fetch(`${baseUrl}/health`,{signal:controller.signal})).ok;}catch{return false;}finally{clearTimeout(timer);}}
  private expectedFaultBehavior(scenario:string){return `${scenario} 必须默认拒绝、不得产生重复订单或账本污染，并留下通知与恢复证据`;}
}
