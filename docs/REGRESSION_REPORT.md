# XichuQuant v1.0.0 独立回归报告

2026-10-10（Asia/Shanghai），所有命令来自新项目目录与新虚拟环境/依赖；不引用旧 557 项作为通过证据。Broker OFFLINE/DISABLED，外部字段为空，IBKR_TWS_API_READ_ONLY=true。原私人 .env 未载入，原业务数据库未连接。

| 检查 | 本轮结果 | 范围 |
| --- | --- | --- |
| frozen-lockfile / Python 固定 requirements | PASS | 新安装；未升级依赖/锁文件 |
| Lint / Typecheck / Build | PASS | 全 workspace、Seed/Admin、Next.js 实际生产构建 |
| Prisma Validate / Generate | PASS | 新目录 schema 与 Client |
| API tests | PASS，183 | 0 fail，0 skipped |
| Broker Connector tests | PASS，20 | 0 fail，0 skipped |
| Python tests | PASS，47 | 1 个既有 Starlette/httpx 弃用警告 |
| SQL 集成 B / C | PASS，4 + 3 | 两组独立新库，各自保留全部既有测试 |
| 生产模式桌面/手机 Playwright | PASS，300 | 1920×1080 / 390×844，真实登录、Session、安全 Cookie；未缩减范围 |
| 独立总数 | **PASS，557** | 183+20+47+4+3+300；重跑不累加 |

Playwright 的一些加载/空数据/错误状态使用既有 HTTP mock；生产登录、SSR、合成回测、内部 Fill、数据库和门禁另有实际验证。测试通过不代表外部券商认证。

## Windows 18 步实际证据

| 步 | 结果与证据 |
| --- | --- |
| 1–5 前置环境 | Windows x64、Node 22.22.2、pnpm 11.9.0、Python 3.12.10、SQL Server 2019；setup.cmd CheckOnly 通过 |
| 6–7 依赖/Prisma | 新依赖与虚拟环境，setup.cmd 实际安装/Generate |
| 8 独立库 | 新建 Accept / Integration / Public / Browser / Admin 五个隔离库，所有 19 migrations 实际应用 |
| 9 管理员 | Demo 强随机密码；Admin 空白库 1 用户、0 Account、0 Trade；已有用户拒绝覆盖 |
| 10–11 生产启动/健康 | start-prod.cmd 实际入口与其 start-local Production 实现启动四项服务；已完成真实生产构建，启动使用 SkipBuild；health-check 四项成功，所有外部写能力 false |
| 12 页面 | 真实生产登录、SSR 从所选 Demo 库读取 DLA2；桌面/手机截图人工审阅，品牌/来源标签可见 |
| 13 Demo/幂等 | 明确授权 Seed；B 集成验证重复 Seed 保留修改、多账户隔离；Public 数据核验拒绝 UNKNOWN/HISTORICAL 注入 |
| 14 回测 | 实际 COMPLETED，既有 AAPL 基准策略、SEED_V1_3 合成行情 |
| 15 内部 Paper | 实际 PaperFill，重复 run/process 不重复成交；普通与外部账本不变 |
| 16 停止 | stop-dev.cmd 验证 launcher 所有权并停止新项目进程树；所有验证服务最后停止 |
| 17 备份 | backup.cmd COPY_ONLY/CHECKSUM + RESTORE VERIFYONLY 实际通过 |
| 18 恢复 | restore-test.cmd 新 _RestoreTest 库，CHECKDB、19 migrations、10 张表行数/SQL 校验摘要一致；既有目标重跑拒绝 |

独立库与新测试登录名称在私人证据中保存，公开报告不记录凭据/本机绝对路径。未 reset/drop 任一原库或测试库。没有来自原项目数据库的读写；数据库权限仅为新的测试登录和新库设置。

## 认证与安全门禁

真实 HTTP 验证未登录 401、缺 CSRF 403、退出后 401，Web Session 与 DEMO 来源；公共只读 Demo 的上传、回测执行、内部交易、同步、外部提案五个 POST 全 403，普通及外部账本 fingerprint 不变。Live/Paper 能力在 OFFLINE 模式全 false。

完整测试覆盖风险超限、Kill Switch、Stop 缺失/无效/数量不符、未知/过期行情拒绝、幂等、佣金延迟、SHORT、资金流、拆股、年度利润证据与跨账户身份。样本外/Walk-forward 算法随 Python 回归保留；未声称本轮外部行情收益或外部 Paper 成交认证。

配置实测拒绝重复键、未闭合引号、非法赋值、重复 database；敏感输出脱敏通过。安装拒绝非空初始化、恢复拒绝已存在目标，库保留。Seed 和公共 Demo 新前缀拒绝旧 XichuRisk 库，未取消安全限制。

## 失败与纠正记录

私有验收包装器最初把 pnpm 的正常 stderr 当作 PowerShell 终止错误，并有并发日志锁；修正包装器、保留日志并重跑，项目质量检查通过。Admin 安装第一次因另一验收进程持有 Prisma Windows DLL 而 Generate 失败，服务停止后独立完整重跑通过。公共 Demo 的首次 health 在服务监听就绪前运行失败，真实会话/拒绝验收通过后再次等待就绪核验健康。没有删测试、关闭风控或把失败计入通过。

CLI 浏览器观察到继承的 favicon.ico 404；不影响登录/功能，未作为零控制台错误认证。其余页面结果以原有 300 项断言和实际 QA 范围为准。

## 未执行范围

Docker Engine pipe 不可用，实际 build/up/volume/network/restore 全 NOT_RUN。Compose local 与 production+demo 静态验证、三个 bash -n 和 Linux 配置验证通过，不能替代容器实测。外部 IBKR Paper、真实 Gateway 身份/行情/订单闭环、72h Soak、全新第二台 Windows、官网部署/DNS均 NOT_RUN；没有外部订单授权。

脱敏运行摘要和日志 SHA-256 见 [机器证据](REGRESSION_EVIDENCE.json)；原始日志、配置、storageState 与 QA 图片在忽略的本地证据目录，未提交。
