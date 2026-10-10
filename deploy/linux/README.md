# Linux 本地部署准备

完整步骤见 [Docker 本地部署说明](../../docs/DOCKER_LOCAL_DEPLOYMENT.md)。本阶段没有运行 Docker Engine，构建与容器验收为 NOT_RUN。

从 `local.env.example` 创建权限为 600 的独立环境文件，填写自己的强密码、唯一 Demo 数据库名和环境密钥。环境检查不 source/eval 文件。默认启动没有自动迁移和 Seed；首次初始化必须显式运行工具 profile。

```bash
node deploy/linux/check-environment.mjs .env.docker-local
bash deploy/linux/certify-phase-c.sh .env.docker-local
```

脚本实际执行构建、健康检查、隔离迁移和 Seed、登录、回测、内部 Paper 成交、服务重启、持久化、备份和新目标恢复。失败立即停止；保留容器、卷和证据，不删除数据库。旧 `certify-v1.9.sh` 只转发至此流程。

`docker-compose.production.yml` 是 TLS 部署模板；需要用户自己的证书、访问控制和另行批准的部署。`docker-compose.gateway.yml` 仅供独立 Paper Gateway 联通验证，不能与公开 Demo 混用。当前阶段禁止外部 Paper 订单和网站部署。
