# XichuQuant 公共 Demo 部署交接

目标：`https://risk.demo.xichugeek.com`。应用适配已完成本地验收，官网 Demo 尚未部署。本轮未连接服务器、修改 DNS/网关或创建 Release/Tag。Linux Docker 运行、目标 HTTPS、备份恢复及实际负载仍须在单独批准的部署阶段验证。

## 访客认证及限制

只读 Demo 保留同一虚构演示账号的多个独立随机 Session 和 CSRF；退出只注销当前 Session。容量已满时新登录返回 429，不驱逐已有访客。个人部署仍在登录时撤销该用户的旧 Session。

| 配置 / 行为 | 公共 Demo |
| --- | --- |
| `PUBLIC_DEMO_MAX_SESSIONS` | 默认每账号 100 个活动 Session，可配置 2–500 |
| `SESSION_TTL_HOURS` | 默认 1、最大 4 小时；个人模式默认 8、最大 24 小时 |
| 会话清理 | 登录事务中删除该账号已到期/撤销的 Session |
| 登录记录清理 | Demo 登录时删除早于 15 分钟窗口的 LoginAttempt |
| 登录限流 | 每个解析后的访客 IP 每分钟 10 次，包含成功/失败；Demo 全局每分钟 60 次 |
| 密码失败 | 同一 IP/用户名窗口内失败 5 次，锁定 15 分钟 |
| 并发容量 | SQL Serializable 事务，冲突最多重试两次；没有数据库结构改动 |
| Cookie / 退出 | HttpOnly/Secure/SameSite Strict Session，退出校验 Origin 和当前 Session 的 CSRF |

启动拒绝非 production、非 DEMO 库、非 HTTPS、无明确代理列表及非只读券商配置；继续检查实际账户、BrokerAccount、行情来源和连接状态。只允许 DEMO/SYNTHETIC 数据。业务写请求全部 403，例外仅登录/退出；外部 IBKR 和全部 Live 写能力仍禁用。

## 明确的代理信任

`TRUSTED_PROXY_IPS` 仅接受明确 IP，默认不信任任何地址。拒绝 `true`、hop 数、CIDR 和 wildcard。Express 据此解析 `request.ip`/`request.secure`；客户端自报的 X-Forwarded-For/Proto 不会自动获得信任。普通 HTTPS 反代部署也需明确填写实际代理 IP。

链路：访客 → 现有 Caddy（HTTPS）→ 独立 Nginx（内部 8080）→ Web/API。仅 Nginx 连接 `xg_edge`；其他服务不发布主机端口，新 backend/frontend 均 internal。Nginx/Web 在专用 frontend 使用独立固定 IP，API 只信任这两个地址。Web SSR 向固定 API 转发经入口清洗的访客地址、协议与当前 Cookie。

Nginx 只信任 `CADDY_TRUSTED_PROXY_IP` 指定的 Caddy 单个地址，业务入口拒绝其他 edge 容器直连，并覆盖下游转发头；私有 `/health` 不返回业务数据。部署时核对 Caddy 在 xg_edge 上的真实 IP；IP 变化后重新核验，不能改成信任整段网段。新 subnet 必须与既有网络不冲突。

以下是新增路由候选片段；先完成 Forge 备份及网关校验，保留所有原有站点/全局配置，不直接覆盖整个 Caddyfile：

```caddyfile
risk.demo.xichugeek.com {
    reverse_proxy xg-xichuquant-proxy:8080 {
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-Host risk.demo.xichugeek.com
    }
}
```

此方案按 Caddy 直接面对访客设计。若前面有 CDN/另一层代理，须明确链路和受信来源，不能自动信任客户端 header。参考：[Express 代理信任](https://expressjs.com/en/guide/behind-proxies/)、[Caddy header_up](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers)、[Nginx realip](https://nginx.org/en/docs/http/ngx_http_realip_module.html)。

## 环境与资源配置

模板为 `deploy/linux/public-demo.env.example`；复制成未跟踪的受保护文件并设为 600。`INVALID_EXAMPLE` 必须本地替换，模板不能初始化实际应用。演示访问密码不得复用个人密码；数据库/JWT/pepper 始终私有，不进入页面或仓库。

- 仅新建 `XichuQuantDemo_public`，SQL 密码与 DATABASE_URL 一致；不导入个人/业务库或真实账户。
- 固定 HTTPS WEB_ORIGIN、`PUBLIC_DEMO_READ_ONLY=true`、`XICHURISK_DATA_MODE=DEMO`。
- Broker `OFFLINE/DISABLED`、TWS read-only；IBKR 账号/允许列表/URL、外部行情/FRED 密钥均为空，不加载 gateway overlay。
- 核对 frontend subnet、Nginx/Web 静态地址及 Caddy 实际 IP。模板私网地址是隔离容器示例，Caddy 文档地址必须替换。API 代理列表由目标 overlay 生成。
- 只读禁用的是交易/业务写入；登录、退出、到期清理等认证元数据按上述规则写入。

使用 base + `docker-compose.demo.yml` + `docker-compose.public-demo.yml`，独立 project 名 `xg-xichuquant-demo`。不要叠加直接占宿主 80/443 的 production overlay、local overlay 或个人 Gateway overlay。

| 常驻服务 | 内存上限 | CPU | PID 上限 |
| --- | --- | --- | --- |
| SQL Server 2022 Express | 2 GiB | 2.00 | 256 |
| API | 512 MiB | 0.50 | 128 |
| Web | 512 MiB | 0.50 | 128 |
| quant-engine | 384 MiB | 0.50 | 128 |
| broker-connector OFFLINE | 128 MiB | 0.25 | 128 |
| 专用 Nginx | 128 MiB | 0.25 | 64 |
| 合计 | **3.625 GiB** | **4.00** | — |

继承 json-file 10 MiB × 3、healthcheck 和 restart policy。代理非 root/read_only/cap_drop ALL，使用限定 tmpfs；db-init/migrate/seed 临时工具也有资源限制。

此前资源快照可支持初始预算，但不能代替部署当天检查和负载认证。预留约 2 GiB 给已有业务；顺序构建并限制独立构建器，运行 mem_limit 不限制构建内存。实际构建固定 image digest、保留第三方 notices。SQL 最低内存依据：[Microsoft Linux 要求](https://learn.microsoft.com/en-us/sql/linux/install-upgrade/setup?view=sql-server-ver17#system-requirements)。

## Forge 执行顺序（本轮未执行）

使用交接回执的精确 Git SHA 打包，不能使用不明工作区或私有附件 zip。先核对服务器只读基线/资源并完成当前 Forge 本地/R2 新鲜备份；既有 WordPress 备份不自动覆盖新 SQL 卷，须明确 Demo 独立备份和异地恢复范围。

```bash
node deploy/linux/check-environment.mjs .env.public-demo --public-demo
docker compose -p xg-xichuquant-demo --env-file .env.public-demo -f docker-compose.yml -f docker-compose.demo.yml -f docker-compose.public-demo.yml config --quiet
```

1. 用同一 compose/project/env 参数顺序构建镜像、记录 digest；先等待 SQL 健康。
2. 仅对全新 Demo 库依次运行 tools profile 的 db-init/db-migrate/db-seed，Seed 明确确认 `CREATE_FICTIONAL_DEMO`；不重置既有库。
3. 启动常驻服务，通过实际健康、虚构来源、OFFLINE 和业务写拒绝检查；不开放 SQL/Connector 端口。
4. 只新增/复用 risk.demo DNS，冲突即停；校验 Caddy 候选与旧路由保留后，按已批准流程 reload。
5. 验证受信 HTTPS、桌面/手机、两访客、CSRF/退出、只读、OOM/重启及新 SQL 的独立备份恢复，核对官网/WordPress/其他 Demo。

失败仅停止新 project 或撤销新路由，保留卷和证据；不全局 down/prune/删卷，不重启其他服务，不执行外部 Paper 订单。官网入口与 Episode 007 继续按后续独立范围推进。

## 本地验收与复验

真实 SQL 集成覆盖双访客、容量拒绝、5 个并发登录不超限、会话/记录清理、个人模式旧 Session 撤销和失败锁定；隔离集成验证非 DEMO 账户与 HISTORICAL 行情会被拒绝。

浏览器采用真实生产 API/Web、独立 Context 和本地 HTTPS；受保护环境提供随机测试凭据。桌面/手机均完成 A 登录 → B 登录 → A 访问 → B 点击退出 → A 仍有效；跨 Session CSRF 和业务写入均 403。不公开 Cookie、密码、storageState 或认证 trace。

```powershell
# 先启动本地独立生产 Demo/TLS，加载受保护测试环境。
corepack pnpm --filter api exec tsx --test src/common/deployment-safety.test.ts src/common/production-security.test.ts src/common/trusted-proxy.test.ts
corepack pnpm exec tsx --test tests/integration/public-demo-auth.integration.test.ts tests/integration/phase-c.integration.test.ts
corepack pnpm exec playwright test --config playwright.public-demo.config.ts
python scripts/test_public_demo_deployment.py
python scripts/test_release_verify.py
python scripts/release-verify.py
```

浏览器仅接受本机验收 URL，证据位于忽略目录 `output/playwright/public-demo/`；生产不用测试自签名证书或 ignoreHTTPSErrors。当前本地认证/只读验收 PASS，Linux Docker 为 NOT_RUN、外部 IBKR Paper 为 NOT_RUN、官网 Demo 为 NOT_DEPLOYED。
