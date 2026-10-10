# XichuQuant / 西楚量化交易系统

**XichuQuant — Quantitative Trading & Risk Management** 是完整的量化研究、交易风险控制和模拟交易系统，供个人用户在自己的电脑上运行。它不保证收益，合成数据回测也不构成历史盈利证据。

本项目的独立发行候选版本为 **v1.0.0**，完整继承已审定 V1.11 功能。当前处于本地发行验收：**原创部分采用 MIT；公开 Push、Tag、Release 均等待维护者审批**。

## 功能与界面

保留原有 Dashboard、账户与持仓、IBKR CSV 导入、历史行情、策略与回测、样本外验证、Walk-forward、策略组合、资金分配、风险引擎、行为风控、保护性 Stop、内部 Paper、Broker Paper 账本、IBKR Paper Connector、Shadow Trading、成交与佣金、对账审计、事故复盘、备份恢复。

界面与布局沿用现有系统。公开截图在脱敏审查后补充，当前不发布私人截图。可复现页面及取证要求见 [Episode 007 证据清单](docs/EPISODE_007_EVIDENCE_MANIFEST.md)。

## 技术架构

| 服务 | 技术 | 本地端口 |
| --- | --- | --- |
| Web | Next.js / React / TypeScript | 5088 |
| API | NestJS / Prisma | 5089 |
| Quant Engine | Python 3.12 / FastAPI | 5091 |
| Broker Connector | TypeScript / IBKR TWS Socket 与 HTTP | 5092 |
| 数据库 | SQL Server 2019+，19 个 Migration | 1433 |

pnpm workspace 管理四个应用与共享包，Playwright 验证桌面和手机界面。本地 API/Connector 使用回环地址，Docker 的数据库和内部服务保持私有。

## 安装环境

**推荐用户本地部署。** Windows 10/11 或 Windows Server x64；Node.js >=22.12.0、Corepack、pnpm 11.9.0、Python 3.12 x64、SQL Server 2019+、Microsoft sqlcmd。SQL Server 需 SQL 身份认证、TCP 和独立库权限。Linux 推荐 Docker Engine/Compose，SQL Server 镜像需受支持的 x86-64 环境。

## Windows 本地安装

先配置自己的本地 SQL Server。在项目根目录，用编辑器将 `.env.example` 复制为尚不存在的 `.env.demo-local`。替换所有 `INVALID_EXAMPLE`，使用自己的数据库凭据与独立随机 JWT、pepper、强管理员密码。

首次体验使用 `XichuQuantDemo_local`，设置：

```dotenv
SEED_DEMO_CONFIRM=CREATE_FICTIONAL_DEMO
XICHURISK_DATA_MODE=DEMO
NEXT_PUBLIC_DATA_MODE=DEMO
BROKER_CONNECTOR_MODE=OFFLINE
BROKER_CONNECTOR_ENVIRONMENT=DISABLED
IBKR_TWS_API_READ_ONLY=true
PUBLIC_DEMO_READ_ONLY=false
WEB_ORIGIN=http://localhost:5088
REQUIRE_HTTPS=false
```

环境中的外部账户、白名单与地址字段保持明确为空。保留兼容的 `XICHURISK_*` 配置键和 `@xichu-risk/*` 内部包名；用户界面品牌统一为 XichuQuant。新项目数据库必须使用新前缀，旧 XichuRisk 库不会被 Seed 或安装初始化接受。

```bat
setup.cmd -EnvFile .env.demo-local -CheckOnly
setup.cmd -EnvFile .env.demo-local -InitializeDatabase -ExpectedDatabase XichuQuantDemo_local -Demo
start-prod.cmd -EnvFile .env.demo-local
health-check.cmd -RequireBrokerOffline
```

打开 [本地登录页面](http://localhost:5088/login)，用户名 `admin`，密码为你配置的 `SEED_ADMIN_PASSWORD`。这只是应用登录。启动会生成 Client、检查迁移、构建并启动四个服务，不自动初始化数据库、Seed 或连接券商。目标非空时初始化拒绝；重复 Seed 保留已修改数据。

空白个人库使用 `XichuQuantLocal_personal`，设置 `ADMIN_USERNAME/ADMIN_PASSWORD`，执行 `setup.cmd -EnvFile .env.local-user -InitializeDatabase -ExpectedDatabase XichuQuantLocal_personal -CreateAdmin`。它只创建管理员，不创建账户或导入交易数据。

完整 [18 步安装与验收](docs/LOCAL_INSTALLATION_GUIDE.md) 包含失败处理。日常使用生产入口；`start-dev.cmd` 用于调试。停止用原启动窗口 Ctrl+C 或 `stop-dev.cmd`，脚本会验证本项目进程所有权。

## Linux Docker 本地安装

```bash
cp deploy/linux/local.env.example .env.docker-local
chmod 600 .env.docker-local
# 编辑配置并替换全部占位符，保持 Broker OFFLINE。
docker compose -p xichuquant-local --env-file .env.docker-local -f docker-compose.yml -f docker-compose.local.yml config --quiet
```

后续 build、SQL init、migrate、Seed、up 与恢复验收见 [Docker 本地指南](docs/DOCKER_LOCAL_DEPLOYMENT.md)。当前机器无可用 Docker Engine，**实际容器验收 NOT_RUN**；Compose 静态检查不证明 Linux 可运行。不要将内部端口或本地 HTTP 配置直接暴露公网。

## 首次 Demo、回测与内部 Paper

Demo 账户与 DLA2/DLB2 案例为完全虚构数据，行情标记 `SYNTHETIC`。来源区分 `DEMO / SYNTHETIC / HISTORICAL / INTERNAL_PAPER / IBKR_PAPER / LIVE_READ_ONLY / UNKNOWN`；未知或中断的数据不能显示为已验证真实数据。

回测中心可选现有 `BUY_AND_HOLD_AAPL`、AAPL、2025-01-02 至 2025-06-30、`SEED_V1_3`，结果来自合成日线。样本外与 Walk-forward 使用原有验证流程。

内部 Paper 使用独立模拟账户、策略审批、资金分配、Stop 和退出条件，经风险校验后运行信号与处理订单。实际 Fill、重复任务幂等和账本隔离均需检查。它不会提交外部订单；拒绝时应查看原因与审计，不放宽保护规则。详情见 [Demo 模式](docs/DEMO_MODE.md)。

## IBKR Gateway / TWS

用户自行在官方客户端登录并完成 MFA。**XichuQuant 网页不收集 IBKR 密码或 MFA，Live 下单、改单和撤单始终禁用**。

IBKR Paper 另需账户身份、白名单、实时行情证据、审批、二次确认、保护性 Stop 与风险规则。网关、订阅或来源不可用时保持拒绝。外部 Paper 订单闭环尚未认证，本轮没有执行外部订单。接入步骤见 [本机 IBKR 指南](docs/IBKR_LOCAL_SETUP.md)。

## 数据与交易安全

推荐单用户本地安装，实际环境文件、备份、导入 CSV、storageState 和运行日志不提交。不要用开发 reset 或 Demo Seed 修复业务库。先备份，再在新目标隔离恢复：

```bat
backup.cmd -EnvFile .env.demo-local -SkipApiAudit
restore-test.cmd -EnvFile .env.demo-local -SkipApiAudit
```

`-SkipApiAudit` 用于离线演练；SQL COPY_ONLY/CHECKSUM、VERIFYONLY、CHECKDB 仍执行。日常审计需有效生产会话，见 [备份恢复](docs/BACKUP_RECOVERY.md) 和 [安全边界](SECURITY.md)。

## 在线 Demo 与限制

官网 Docker Demo 目前只是计划，**尚未上线**。未来 Demo 仅用虚构数据、只读或隔离沙箱，不连接观众 IBKR、不接受券商凭据、不提交真实证券订单。发布前还需 Linux 实测、访客身份与并发审查、HTTPS 和资源验收，见 [Demo 计划](docs/PUBLIC_DEMO_DEPLOYMENT_PLAN.md)。

系统当前为单用户管理员模型，不宣称多租户安全、真实交易认证、72 小时稳定性或策略收益保证。Daily 事故分析有近似限制。Windows 验收依赖当前机器已有前置环境，不等于全新电脑认证。其他问题见 [FAQ](docs/FAQ.md) 与 [排查指南](docs/TROUBLESHOOTING.md)。

## 源码、更新与验证

拟公开交付仓库：[xichugeek/XichuQuant](https://github.com/xichugeek/XichuQuant)。本轮只建立本地独立历史，未推送；v1.0.0 尚无正式 Tag/Release。以后公开源码、官网与 Episode 007 使用该项目。

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
corepack pnpm exec prisma validate --schema database/prisma/schema.prisma
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

上述命令需本地 Python 虚拟环境与有效独立配置。完整 SQL、生产认证和 300 项浏览器回归的真实结果见 [回归报告](docs/REGRESSION_REPORT.md)。源哈希、排除清单、隐私和独立 Git 证明见 [迁移报告](docs/RELEASE_MIGRATION_REPORT.md) 与 [发行门禁](docs/RELEASE_READINESS_REPORT.md)。

## 许可证

维护者有权授权的项目原创部分采用 [MIT License](LICENSE)，**Copyright (c) 2026 XichuGeek**。分发时保留版权与许可通知；完整授权与免责条款以根 LICENSE 为准。

第三方依赖、独立许可组件、SQL Server、IBKR 官方客户端与市场数据保留各自许可和使用条件，项目 MIT 不重新授权这些内容。当前交付范围为 Windows 本地源码仓库，包含依赖声明与锁文件，不包含 node_modules、虚拟环境、前端构建产物、浏览器、客户端或系统二进制。未来分发含依赖的 ZIP 或 Docker 镜像前须补充实际产物清单、原版权/NOTICE 与适用源码获取要求。

见 [许可审查](docs/OPEN_SOURCE_LICENSE_REVIEW.md)、[第三方说明](docs/THIRD_PARTY_NOTICES.md)、[机器清单](docs/THIRD_PARTY_INVENTORY.json) 与 [最终发布验收](docs/FINAL_PUBLICATION_AUDIT.md)。MIT 已获维护者批准；本轮未公开推送，Push、Tag、Release 仍需单独明确授权。
