# Linux Docker 本地部署

当前交付包含真实验收脚本，但本轮 Windows 的 Docker Engine 不可连接，镜像构建、容器启动和 Linux 网络实测为 **NOT_RUN**。Compose 静态通过不代表部署完成。

## 环境与配置

SQL Server 镜像要求受支持的 Linux x86-64 环境；不把 ARM 主机视作已支持。安装 Docker Engine/Compose，以及验收脚本所需 Node.js。SQL Server 许可/EULA 由使用者确认，项目许可证不覆盖数据库镜像。

现有 Dockerfile/Compose 保持 Web、API、Quant Engine、Connector、SQL Server 和反向代理。数据库有独立 data/backup named volumes；默认 Broker OFFLINE。API、SQL、Quant 和 Connector 不发布 host 端口；本地代理只绑定 `127.0.0.1:5088`。

```bash
cp deploy/linux/local.env.example .env.docker-local
chmod 600 .env.docker-local
# 用本机编辑器设置独立 SQL、JWT、pepper 和管理员强密码；不要 source/eval 该文件。
docker compose --env-file .env.docker-local -f docker-compose.yml -f docker-compose.local.yml config --quiet
```

首次复制仅用于不存在的文件，已有环境文件需保留。DATABASE_URL 指向容器名 `sqlserver`；数据库字段必须与 XICHURISK_DATABASE_NAME 相同。SQL 密码须与 MSSQL_SA_PASSWORD 一致，特殊连接字符采用 Prisma 支持的编码。不要打印完整 `compose config`、`.Config.Env` 或把密码放 `sqlcmd -P` 参数。

## 正式启动顺序

使用独立 Compose project 名称，下面示例 `xichuquant-local` 不应与现有服务同名。

```bash
docker compose -p xichuquant-local --env-file .env.docker-local -f docker-compose.yml -f docker-compose.local.yml build
docker compose -p xichuquant-local --env-file .env.docker-local -f docker-compose.yml -f docker-compose.local.yml up -d --wait sqlserver
docker compose -p xichuquant-local --env-file .env.docker-local -f docker-compose.yml -f docker-compose.local.yml run --rm db-init
docker compose -p xichuquant-local --env-file .env.docker-local -f docker-compose.yml -f docker-compose.local.yml run --rm db-migrate
docker compose -p xichuquant-local --env-file .env.docker-local -f docker-compose.yml -f docker-compose.local.yml run --rm db-seed
docker compose -p xichuquant-local --env-file .env.docker-local -f docker-compose.yml -f docker-compose.local.yml up -d --wait
```

Seed 仅用于明确确认的独立 Demo 库。空白用户库改用独立 `XichuQuantLocal_*`，手动运行 admin-init，不运行 db-seed。API 日常启动不运行 migration 或 Seed；已有库迁移需备份、恢复演练与审查。持久卷里的 SQL 密码不会因为更改环境文件自动轮换；不要删除卷来“修复”认证。

打开 http://localhost:5088/login，应用管理员密码由用户生成。远程访问不能把本地 HTTP 代理绑定到公网；使用 `docker-compose.production.yml` 的 HTTPS/VPN 或身份访问代理。生产 TLS 文件、REQUIRE_HTTPS 和 WEB_ORIGIN 必须真实配置。SQL/Connector 始终私有。

## 完整实际验收

```bash
bash deploy/linux/certify-phase-c.sh .env.docker-local
```

脚本创建独立时间戳 project，验证 Linux/架构、环境文件权限、DB 名称/凭据一致、Broker OFFLINE，真实执行 build、SQL 启动、init、migration、两次 Seed、服务健康、生产认证/CSRF、Web 服务端数据、历史回测、内部 Paper 成交及幂等、账本隔离、重启持久化、COPY_ONLY/CHECKSUM 备份、VERIFYONLY、新库恢复/CHECKDB、私有端口和网络检查。

失败即停，保留容器、卷、测试库和 `Agent/Temp/` 脱敏证据；不执行 down -v、reset、强推或外部订单。成功仅认证实际跑过的范围；主机重启、GUI 浏览器验收、Gateway/API 身份和 72 小时 Soak 仍须另跑。

Web 登录的脚本证据是实际 HTTP Session，不替代 Linux 目标机的桌面/移动浏览器 QA。本项目现有 Playwright 可按生产认证配置运行；只保存私有 storageState，不公开 Session Cookie。

## 容器访问宿主机 Gateway / TWS

默认不添加宿主机入口。需要访问用户自行运行的 Gateway 时，单独审查 `docker-compose.gateway.yml`：仅 Connector 增加 gateway 网络和 `host.docker.internal:host-gateway` 映射。Linux 原生 Docker 不应假设该名字天然存在；映射地址由实际 Docker daemon 决定。参见 [Docker host-gateway 文档](https://docs.docker.com/reference/cli/dockerd/)。

验证分三层，不能用 TCP 成功代替账户认证：

1. 宿主机检查 Gateway 的真实监听地址/端口与 Trusted IP、防火墙；只绑定 127.0.0.1 的 Socket 通常不能通过 Docker bridge 到达。
2. 在 Connector 容器读取该别名解析并做有超时的只读 TCP 探测；记录网络、映射、允许的源 IP。不公开 API 端口。
3. 用户登录后，用 read-only TWS API 核对 Paper 身份、账户、来源、时间戳和白名单，再回读订单/成交。写权限仍禁用。

如果现有客户端安全设置只允许回环，保持该设置；不要为使 Docker 连通而关闭券商安全控制。选择宿主机本地方式，或另行审查受限绑定/访问网络。当前 TWS 实现只允许 localhost/127.0.0.1/::1/host.docker.internal 与 Paper 4002/7497；任意外部 IP 或 Live 端口不在支持范围内。

本轮没有可用的 Linux Docker+Gateway 组合，因此该连接实测 **NOT_RUN**。公共 Demo 禁止加载 gateway overlay 或连接个人会话。

## 持久化、权限和失败处理

- Node 应用与 Quant 容器使用非 root 用户；应用加 no-new-privileges。Web 缓存有写权限，数据库 data/backup 由 SQL 服务管理。镜像构建上下文排除环境、密钥、依赖、构建产物、上传与私有日志。
- 服务有健康检查、restart policy 和内存/CPU 上限；日志应限制大小和保留数量。Node/SQL 镜像现有浮动 tag 的实际 digest 需在真实构建后记录，本轮不编造 image identity。
- DB/backend 网络 internal；Web 不接入数据库网络。Connector host 访问仅适用于专门批准的 gateway 网络。反向代理入口和跨网络请求仍需实测。
- 环境错误应修复文件并重新验证，不能转发数据库端口、放宽只读或使用示例管理员密码。
- 启动失败检查脱敏日志、卷权限、SQL 内存、迁移状态和端口；只停止这个 project，保留恢复证据。
- 备份保存在 SQL server backup volume，需另行加密复制到受保护离机存储。一个 volume 内的备份不是灾难恢复；隔离恢复不能覆盖当前数据。

旧 `deploy/linux/README.md` 指向本指南。旧 V1.9 验收入口委托到安全的阶段 C 验收，不能继续硬编码业务库执行旧流程。
