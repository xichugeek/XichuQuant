# XichuQuant 源码复制与变更清单

日期：2026-10-10（Asia/Shanghai）。来源为 XichuRisk 的干净审定提交 `37f5e4e750abd515f5bce0c92b1493be815628e0`，分支 `codex/v1.11-open-source-release`。从 Git 跟踪树明确允许清单执行 archive，未复制工作区、旧 .git、refs、Tag 或 bundle。

原始跟踪文件 **450**；保留 **414** 个源文件（其中业务/Schema/Migration/测试源码 **296**）；排除 **36** 个历史文件。字节完全一致 **371** 个，审阅变更 **43** 个。新增加独立发行报告、机器清单、Changelog 和只读核验脚本，最终文件数量见 JSON 的 `target_public_count`；所有 414 个保留源文件有源/目标 SHA-256。

[机器清单](SOURCE_COPY_MANIFEST.json) 列出每个保留文件的源路径、目标路径、SHA-256、变更标记，并枚举所有排除项。source_sha256 是审定 git archive 导出字节，source_git_blob_sha256 是审定 Git blob 原字节，目标值来自实际文件；两者分别记录，避免原项目 autocrlf 导出换行与 Git blob 不同造成误判。LF 归一化散列用于跨 Windows/Linux 内容核验，原始字节散列另保留。

## 允许范围与功能完整性

保留 apps/web、apps/api、apps/quant-engine、apps/broker-connector、packages/shared、packages/validators、database/prisma（含 19 个原样 Migration）、全部 tests、全部已跟踪的用户安装/备份/验收 scripts、deploy/linux 和根配置。apps/mobile/.gitkeep 也保留。

Dashboard、账户/持仓、CSV 导入、行情、策略、回测、样本外、Walk-forward、组合、资金分配、风险/行为纪律/Stop、内部 Paper、Broker Paper、IBKR Connector、Shadow、成交/佣金、对账/审计、事故复盘、备份恢复全部保留。API 路由、表名、Migration、内部包名、安全环境键、幂等键不因更名改变。

## 实际变更登记

业务计算、策略、执行、账本逻辑没有重构。数据库安全规则发生必要变更：seed-safety、public Demo 配置校验、Windows/Linux 初始化只接受 XichuQuant 新前缀，仍拒绝旧库、个人库与歧义字段；相关拒绝测试与实际隔离验证通过。Seed 仅更改虚构恢复目标的名称。一个账户脱敏测试改用明确构造的顺序数字 Fixture 并同步其掩码断言，未删测试。

核心范围变更文件：`apps/api/src/app.service.ts`, `apps/api/src/common/deployment-safety.test.ts`, `apps/api/src/common/deployment-safety.ts`, `apps/api/src/modules/broker-execution/phase-b-safety.test.ts`, `apps/api/src/modules/broker-sync/broker-v1.7.test.ts`, `apps/quant-engine/app/creator_factor_research.py`, `apps/quant-engine/app/main.py`, `apps/web/app/login/page.tsx`, `apps/web/components/app-shell.tsx`, `database/prisma/seed-safety.ts`, `database/prisma/seed.ts`, `packages/shared/src/index.ts`。

其他变更为应用名/展示文案、User-Agent 软件名、根包发行版本、任务名、Compose project 名、模板独立库名、忽略私有证据与新项目文档。需要改名的文件仅 `docs/LICENSE_REVIEW.md → docs/OPEN_SOURCE_LICENSE_REVIEW.md`，统一为一份许可审查。

| 源文件 | 目标文件 | 变更分类 |
| --- | --- | --- |
| `.dockerignore` | `.dockerignore` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `.env.example` | `.env.example` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `.env.production.example` | `.env.production.example` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `.gitignore` | `.gitignore` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `LICENSE` | `LICENSE` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `README.md` | `README.md` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `SECURITY.md` | `SECURITY.md` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `apps/api/src/app.service.ts` | `apps/api/src/app.service.ts` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `apps/api/src/common/deployment-safety.test.ts` | `apps/api/src/common/deployment-safety.test.ts` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `apps/api/src/common/deployment-safety.ts` | `apps/api/src/common/deployment-safety.ts` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `apps/api/src/modules/broker-execution/phase-b-safety.test.ts` | `apps/api/src/modules/broker-execution/phase-b-safety.test.ts` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `apps/api/src/modules/broker-sync/broker-v1.7.test.ts` | `apps/api/src/modules/broker-sync/broker-v1.7.test.ts` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `apps/quant-engine/app/creator_factor_research.py` | `apps/quant-engine/app/creator_factor_research.py` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `apps/quant-engine/app/main.py` | `apps/quant-engine/app/main.py` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `apps/web/app/login/page.tsx` | `apps/web/app/login/page.tsx` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `apps/web/components/app-shell.tsx` | `apps/web/components/app-shell.tsx` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `database/prisma/seed-safety.ts` | `database/prisma/seed-safety.ts` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `database/prisma/seed.ts` | `database/prisma/seed.ts` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `deploy/linux/certify-phase-c.sh` | `deploy/linux/certify-phase-c.sh` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `deploy/linux/check-environment.mjs` | `deploy/linux/check-environment.mjs` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `deploy/linux/init-database.sh` | `deploy/linux/init-database.sh` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `deploy/linux/local.env.example` | `deploy/linux/local.env.example` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `docker-compose.yml` | `docker-compose.yml` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `docs/BACKUP_RECOVERY.md` | `docs/BACKUP_RECOVERY.md` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `docs/DEMO_MODE.md` | `docs/DEMO_MODE.md` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `docs/DOCKER_LOCAL_DEPLOYMENT.md` | `docs/DOCKER_LOCAL_DEPLOYMENT.md` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `docs/FAQ.md` | `docs/FAQ.md` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `docs/IBKR_LOCAL_SETUP.md` | `docs/IBKR_LOCAL_SETUP.md` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `docs/LICENSE_REVIEW.md` | `docs/OPEN_SOURCE_LICENSE_REVIEW.md` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `docs/LOCAL_INSTALLATION_GUIDE.md` | `docs/LOCAL_INSTALLATION_GUIDE.md` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `docs/PUBLIC_DEMO_DEPLOYMENT_PLAN.md` | `docs/PUBLIC_DEMO_DEPLOYMENT_PLAN.md` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `docs/THIRD_PARTY_INVENTORY.json` | `docs/THIRD_PARTY_INVENTORY.json` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `docs/THIRD_PARTY_NOTICES.md` | `docs/THIRD_PARTY_NOTICES.md` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `docs/TROUBLESHOOTING.md` | `docs/TROUBLESHOOTING.md` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `package.json` | `package.json` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `packages/shared/src/index.ts` | `packages/shared/src/index.ts` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `scripts/backup-database.ps1` | `scripts/backup-database.ps1` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `scripts/install-daily-backup-task.ps1` | `scripts/install-daily-backup-task.ps1` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `scripts/restore-test-database.ps1` | `scripts/restore-test-database.ps1` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `scripts/setup-local.ps1` | `scripts/setup-local.ps1` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `scripts/start-local.ps1` | `scripts/start-local.ps1` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `scripts/stop-dev.ps1` | `scripts/stop-dev.ps1` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |
| `scripts/verify-phase-b.ps1` | `scripts/verify-phase-b.ps1` | Scoped release branding/documentation or dedicated DB safety prefix; see change register |

## 全部排除的跟踪文件

| 路径 | 原因 |
| --- | --- |
| `Agent/Doc/IBKR-Gateway-TWS-API-Paper-本机接入说明.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/IBKR-Paper订单执行安全设计.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/Risk-Discipline-Hardening.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.1-真实数据持久化说明.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.2-IBKR数据导入与账户同步说明.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.3-行情数据中心与量化回测基础说明.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.3-项目交接文档.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.4-策略稳健性验证与模拟交易闭环说明.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.4-项目交接文档.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.5-自动行情同步与前向模拟观察说明.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.5-项目交接文档.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.6-策略组合与资金分配说明.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.6-项目交接文档.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.7-IBKR只读同步账户对账与影子交易说明.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.7-项目交接文档.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.8-IBKR模拟券商执行与生产安全加固说明.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.8-项目交接文档.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.9-IBKR-Paper外部验收报告.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.9-Linux部署实测报告.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.9-外部环境认证与长时间稳定性验证说明.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.9-故障注入与恢复报告.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.9-长时间稳定性测试报告.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/V1.9-项目交接文档.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/执行事故处理手册.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/生产部署与灾难恢复说明.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `Agent/Doc/西楚投资风控系统_Codex开发文档.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `CHANGELOG.md` | 旧迭代日志；新建独立 v1.0.0 Changelog |
| `docs/DEMO_DATA_ISOLATION_REPORT.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `docs/EXECUTION_GUARD_VERIFICATION.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `docs/PHASE_B_IMPLEMENTATION_REPORT.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `docs/PHASE_C_IMPLEMENTATION_REPORT.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `docs/PHASE_C_REGRESSION_REPORT.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `docs/PRIVACY_AND_HISTORY_AUDIT.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `docs/PUBLIC_HISTORY_CLEANUP_PLAN.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `docs/REGRESSION_REPORT.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |
| `docs/RELEASE_READINESS_REPORT.md` | 历史开发或私有验收报告；替换为新项目的独立发行报告 |

另外旧 .git/.git/codex-checkpoints、实际 .env、凭据、私人 CSV/导入、SQL 数据/备份、持仓快照、真实事故资料、Agent 日志/截图/Temp、浏览器状态、私人媒体/PDF/Word、node_modules/构建/缓存/虚拟环境均不在允许清单，未从源项目复制。没有扫描后静默删除业务模块。

运行 `python scripts/release-verify.py` 可核验目标散列、允许文件集合和独立 Git；如维护者有源项目，可追加 `--source <原只读目录>` 比较审定源 blob。报告/manifest 的自引用文件只登记路径，不伪造自引用 SHA；提交散列由 Git 验证。
