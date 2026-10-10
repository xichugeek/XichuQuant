# Windows 本地安装指南

推荐个人用户在自己的 Windows 电脑上运行。系统提供研究、风险控制、历史回测和内部模拟交易，不保证收益。实际 IBKR Paper 与内部 Paper 是两个独立账本；Live 始终只读。

## 准备

Windows 10/11 或 Windows Server x64；Node.js >=22.12.0；Corepack；项目指定 pnpm 11.9.0；Python 3.12 x64；SQL Server 2019+ 与 Microsoft sqlcmd。SQL Server 需可用的 SQL 身份认证、TCP 端口和创建独立库的权限。不自动修改服务器认证设置或防火墙。

保持普通用户源码目录可写。数据库文件和备份路径由 SQL Server 服务账户管理，不由 Web 上传文件代替。不要把 5089/5091/5092/1433 转发到公网。

从经许可和隐私审查后的源码包安装；目前公共推送和许可证决定仍未放行。现有开发仓库中的旧 Tag 不应当作已完成隐私验收的下载包。

## 首次体验：独立 Demo

在项目根目录，用编辑器建立 `.env.demo-local`（首次从 `.env.example` 复制，若已存在则保留）。配置：

- DATABASE_URL 的数据库名称改为 `XichuQuantDemo_local`；配置你自己的本地 SQL Server 地址、用户名与密码。整个 URL 不写到终端命令参数或提交中。
- JWT_SECRET、BROKER_ACCOUNT_HASH_PEPPER 使用独立的随机值；SEED_ADMIN_PASSWORD 使用至少 12 位且有大小写、数字、特殊字符的强密码。
- `SEED_DEMO_CONFIRM=CREATE_FICTIONAL_DEMO`，`XICHURISK_DATA_MODE=DEMO`，`NEXT_PUBLIC_DATA_MODE=DEMO`。
- `BROKER_CONNECTOR_MODE=OFFLINE`、`BROKER_CONNECTOR_ENVIRONMENT=DISABLED`、`IBKR_TWS_API_READ_ONLY=true`；券商账户、白名单和外部地址留空。
- 本机浏览器使用 `WEB_ORIGIN=http://localhost:5088`、`REQUIRE_HTTPS=false`、`PUBLIC_DEMO_READ_ONLY=false`。仅限本机；远程访问需另外设置 HTTPS、身份保护和网络隔离。

环境文件按字面读取，不运行里面的 shell 表达式；重复键、未闭合引号、重复 database 参数或错误布尔值会报错。示例占位符不能启动。

启动器还会保留明确清空字段的名称，在 Prisma 初始化前恢复为空值，防止 Windows 删除空环境变量后又被根目录 `.env` 自动填回。不要删掉示例中的外部账户/地址字段来代替清空；保留完整独立配置。原业务 `.env` 不会被修改。

```bat
setup.cmd -EnvFile .env.demo-local -CheckOnly
setup.cmd -EnvFile .env.demo-local -InitializeDatabase -ExpectedDatabase XichuQuantDemo_local -Demo
start-prod.cmd -EnvFile .env.demo-local
health-check.cmd -RequireBrokerOffline
```

登录 http://localhost:5088/login，应用用户名为 `admin`，密码为你配置的 SEED_ADMIN_PASSWORD。这不是 IBKR 登录页面。

启动仅生成 Prisma Client、检查迁移状态、构建并启动服务；不自动迁移、Seed、reset 或连接默认 OFFLINE 券商。初始化要求预期数据库名称精确一致，且目标为空库；非空库拒绝。完整 Demo 再次 Seed 不覆盖任何已修改账户和账本。重复执行 `-InitializeDatabase` 会因目标非空退出，而不是重置。

## 空白用户库

建立另一份受保护环境文件，选 `XichuQuantLocal_personal`，不要复用 Demo 库。设置 ADMIN_USERNAME/ADMIN_PASSWORD，保留 Broker OFFLINE。

```bat
setup.cmd -EnvFile .env.local-user -InitializeDatabase -ExpectedDatabase XichuQuantLocal_personal -CreateAdmin
start-prod.cmd -EnvFile .env.local-user
```

只创建管理员，不导入账户、持仓、行情或交易。已有用户时拒绝覆盖密码。空白库需由用户创建账户、规则、标的/策略或导入合法数据；首次功能体验建议使用独立 Demo。当前应用按单用户管理员模型使用，不作为多租户服务。

已有业务库升级：先执行指定库备份和隔离恢复验证，审阅 migration；再在明确选定的环境下手动 `corepack pnpm db:deploy`。本轮开发没有替用户业务库升级。不要用 `db:migrate` 的开发重置提示或 `db:seed` 修复业务库。

## 18 步验收与失败处理

| 步骤 | 操作/成功证据 | 失败处理 |
| --- | --- | --- |
| 1 Windows/架构 | setup CheckOnly 检查 Windows x64 | 不支持 ARM/32 位；使用受支持机器 |
| 2 Node | >=22.12.0 | 安装支持版本，重新打开终端；不升级项目依赖 |
| 3 Corepack/pnpm | 项目固定 pnpm 11.9.0 | 检查 PATH/Corepack 下载和网络；不改锁文件绕过 |
| 4 Python | py -3.12 与虚拟环境均为 3.12 | 安装对应 x64 版本；不使用不兼容 Python |
| 5 SQL | master 只读版本查询 >=2019 | 核对 SQL 认证、端口、权限；密码不放命令参数 |
| 6 依赖 | frozen-lockfile；固定 Python requirements 安装 | 处理代理/网络失败后重跑；禁止随意更新版本 |
| 7 Prisma | db:generate 成功 | 保持 schema/Client 一致；不要 reset |
| 8 独立库 | 显式 InitializeDatabase；19 migrations | 目标非空先检查；失败库保留，不自动删除 |
| 9 管理员 | Demo Seed 或 CreateAdmin | 强密码、已有用户拒绝；不直接覆盖密码哈希 |
| 10 启动 | start-prod 四项服务 | 忙端口明确退出；先检查其所有者，不强杀其他应用 |
| 11 健康 | health-check，所有 Live/Paper 外部写能力为 false | 查脱敏日志、DB、Quant 和 Connector；不放宽风险门禁 |
| 12 真实页面 | 生产登录、首页可读取 DEMO 持仓 | 核对 Cookie、localhost、WEB_ORIGIN 与内部 API 地址；不要回填真实账户假数据 |
| 13 Demo | 虚构标签、独立库、重复 Seed 不覆盖 | 有用户/非 Demo 账户则拒绝，选全新独立库 |
| 14 回测 | 回测中心选择现有 BUY_AND_HOLD_AAPL、AAPL、2025-01-02 至 2025-06-30、SEED_V1_3 | 检查策略是否启用、标的池和行情来源；结果来自合成日线 |
| 15 内部 Paper | 创建独立模拟账户、使用已批准基准策略部署、填写 Stop/退出、启动后按历史交易日运行并处理订单；检查实际 PaperFill | 拒绝则看风险审计，不能去掉 Stop 或伪造批准；不调用 IBKR 外部订单 |
| 16 停止 | Ctrl+C；或 stop-dev.cmd 验证 launcher 所有权后停止本项目进程树 | 所有权未知明确退出；保存工作，检查任务恢复和订单状态 |
| 17 备份 | backup.cmd 对选定库 COPY_ONLY/CHECKSUM + VERIFYONLY | 核对 SQL 服务目录权限、磁盘；保留原库和失败证据 |
| 18 恢复 | restore-test.cmd 新 `_RestoreTest` 库 + CHECKDB + migrations | 已存在目标拒绝，不能用 WITH REPLACE 或覆盖业务库 |

内部模拟验收配置可使用账户 20,000、分配 2,000、最大仓位 15%、预设 3% 下跌退出/20 交易日退出、信号日 2025-06-10；这是合成安装样例，不是交易推荐。必须确认有实际 Fill，不能以 HTTP 成功等同交易完成。

```bat
backup.cmd -EnvFile .env.demo-local -SkipApiAudit
restore-test.cmd -EnvFile .env.demo-local -SkipApiAudit
```

`-SkipApiAudit` 仅用于离线恢复演练或隔离验证，避免把测试运维写到另一个运行中的 API；SQL 原生校验仍执行。日常 API 审计需要有效生产会话，否则会明确警告未写入 UI，不伪造审计成功。保留本地脱敏操作证据。

`start-dev.cmd` 仅调试，生产认证在该模式不启用。日常使用优先 start-prod。`-SkipBuild` 仅用于已验证、源码未变化的构建。详情见 [备份恢复](BACKUP_RECOVERY.md)、[故障排查](TROUBLESHOOTING.md) 和 [IBKR 本机指南](IBKR_LOCAL_SETUP.md)。
